'use strict';

// Native
import path = require('path');

// Packages
import clone = require('clone');
import OBSWebSocket = require('obs-websocket-js');
import { NodeCG, Replicant, Logger } from 'nodecg/types/server';
import { Websocket } from '../types/schemas/websocket';
import { ProgramScene } from '../types/schemas/programScene';
import { PreviewScene } from '../types/schemas/previewScene';
import { SceneList } from '../types/schemas/sceneList';
import { SourceList } from '../types/schemas/sourceList';
import { Transitioning } from '../types/schemas/transitioning';
import { StudioMode } from '../types/schemas/studioMode';
import { Namespaces } from '../types/schemas/namespaces';

interface TransitionOptions {
	'with-transition': {
		name: string;
		duration?: number;
	}
}

export interface Hooks {
	preTransition(transitionOpts: TransitionOptions):
		TransitionOptions | void | Promise<TransitionOptions> | Promise<void>
}

const usedNamespaces = new Set();

export class OBSUtility extends OBSWebSocket {
	namespace: string;
	hooks: Partial<Hooks>;
	replicants: {
		websocket: Replicant<Websocket>;
		programScene: Replicant<ProgramScene>;
		previewScene: Replicant<PreviewScene>;
		sceneList: Replicant<SceneList>;
		sourceList: Replicant<SourceList>;
		transitioning: Replicant<Transitioning>;
		studioMode: Replicant<StudioMode>;
	};
	log: Logger;

	private _ignoreConnectionClosedEvents = false;
	private _reconnectInterval: NodeJS.Timeout | null = null;
	private _connected: boolean;

	constructor(nodecg: NodeCG, opts: {namespace?: string; hooks?: Partial<Hooks>} = {}) {
		super();
		let namespace = 'obs';
		if (opts.namespace !== undefined) {
			namespace = opts.namespace;
		}

		if (usedNamespaces.has(namespace)) {
			throw new Error(`Namespace "${namespace}" has already been used. Please choose a different namespace.`);
		}

		usedNamespaces.add(namespace);
		this.namespace = namespace;
		const namespacesReplicant = nodecg.Replicant<Namespaces>('_obs:namespaces', {
			schemaPath: buildSchemaPath('namespaces'),
			persistent: false
		});
		namespacesReplicant.value.push(namespace);

		const websocketConfig = nodecg.Replicant<Websocket>(`${namespace}:websocket`, {schemaPath: buildSchemaPath('websocket')});
		const programScene = nodecg.Replicant<ProgramScene>(`${namespace}:programScene`, {schemaPath: buildSchemaPath('programScene')});
		const previewScene = nodecg.Replicant<PreviewScene>(`${namespace}:previewScene`, {schemaPath: buildSchemaPath('previewScene')});
		const sceneList = nodecg.Replicant<SceneList>(`${namespace}:sceneList`, {schemaPath: buildSchemaPath('sceneList')});
		const sourceList = nodecg.Replicant<SourceList>(`${namespace}:sourceList`, {schemaPath: buildSchemaPath('sourceList')});
		const transitioning = nodecg.Replicant<Transitioning>(`${namespace}:transitioning`, {schemaPath: buildSchemaPath('transitioning')});
		const studioMode = nodecg.Replicant<StudioMode>(`${namespace}:studioMode`, {schemaPath: buildSchemaPath('studioMode')});
		const log = new nodecg.Logger(`${nodecg.bundleName}:${namespace}`);

		// Expose convenient references to the Replicants.
		// This isn't strictly necessary. The same effect could be achieved by just
		// declaring the same Replicant again, but some folks might like
		// to just work with the references that we return here.
		this.replicants = {
			websocket: websocketConfig,
			programScene,
			previewScene,
			sceneList,
			sourceList,
			transitioning,
			studioMode
		};
		this.log = log;
		this.hooks = opts.hooks || {};

		websocketConfig.once('change', newVal => {
			// If we were connected last time, try connecting again now.
			if (newVal.status === 'connected' || newVal.status === 'connecting') {
				websocketConfig.value.status = 'connecting';
				this._connectToOBS().then().catch(() => {
					websocketConfig.value.status = 'error';
				});
			}
		});

		nodecg.listenFor(`${namespace}:connect`, (params, callback) => {
			this._ignoreConnectionClosedEvents = false;
			clearInterval(this._reconnectInterval!);
			this._reconnectInterval = null;

			websocketConfig.value.ip = params.ip;
			websocketConfig.value.port = parseInt(params.port, 10);
			websocketConfig.value.password = params.password;

			this._connectToOBS().then(res => {
				if (callback && !callback.handled) {
					callback(null, res);
				}
			}).catch(err => {
				if (callback && !callback.handled) {
					callback(err);
				}
			});
		});

		nodecg.listenFor(`${namespace}:disconnect`, (_data, callback) => {
			this._ignoreConnectionClosedEvents = true;
			clearInterval(this._reconnectInterval!);
			this._reconnectInterval = null;
			
			this._disconnectFromOBS().then(res => {
				if (callback && !callback.handled) {
					callback(null, res);
				}
			}).catch(err => {
				if (callback && !callback.handled) {
					callback(err);
				}
			});
		});

		nodecg.listenFor(`${namespace}:previewScene`, async (sceneName, callback) => {
			try {
				await this.send('SetPreviewScene', {'scene-name': sceneName});
				if (callback && !callback.handled) {
					callback();
				}
			} catch (error) {
				log.error('Error setting preview scene:', error);
				if (callback && !callback.handled) {
					callback(error);
				}
			}
		});

		nodecg.listenFor(`${namespace}:transition`, async ({name, duration, sceneName} = {}, callback) => {
			if (studioMode.value) {
				// If in studio mode, set the preview scene, and then transition to it

				if (sceneName) {
					try {
						await this.send('SetPreviewScene', {'scene-name': sceneName});
					} catch (error) {
						log.error('Error setting preview scene for transition:', error);
						if (callback && !callback.handled) {
							callback(error);
						}
						return;
					}
				}

				try {
					await this._transition(name, duration);
				} catch (error) {
					log.error('Error transitioning:', error);
					if (callback && !callback.handled) {
						callback(error);
					}
					return;
				}
			} else {
				// If not in studio mode, set the transition params and then set the scene

				if (name) {
					try {
						await this.send('SetCurrentTransition', { "transition-name": name });
					} catch (error) {
						log.error('Error setting current transition:', error);
						if (callback && !callback.handled) {
							callback(error);
						}
						return;
					}
				}

				if (duration) {
					try {
						await this.send('SetTransitionDuration', { duration: duration });
					} catch (error) {
						log.error('Error setting transition duration:', error);
						if (callback && !callback.handled) {
							callback(error);
						}
						return;
					}
				}

				try {
					// Mark that we're starting to transition. Resets to false after SwitchScenes.
					this.replicants.transitioning.value = true;
					await this.send('SetCurrentScene', {'scene-name': sceneName});
				} catch (error) {
					this.replicants.transitioning.value = false;
					log.error('Error setting scene for transition:', error);
					if (callback && !callback.handled) {
						callback(error);
					}
					return;
				}
			}

			if (callback && !callback.handled) {
				callback();
			}
		});

		nodecg.listenFor(`${namespace}:startStreaming`, (_data, callback) => {
			try {
				this.send('StartStreaming', {});
			} catch (error) {
				log.error('Error starting the streaming:', error);
				if (callback && !callback.handled) {
					callback(error);
				}
				return;
			}

			if (callback && !callback.handled) {
				callback();
			}
		});

		nodecg.listenFor(`${namespace}:stopStreaming`, (_data, callback) => {
			try {
				this.send('StopStreaming');
			} catch (error) {
				log.error('Error stopping the streaming:', error);
				if (callback && !callback.handled) {
					callback(error);
				}
				return;
			}

			if (callback && !callback.handled) {
				callback();
			}
		});

		(this as any).on('error', (error: Error) => {
			log.error(error);
			this._reconnectToOBS();
		});

		this.on('ConnectionClosed', () => {
			this._reconnectToOBS();
		});

		this.on('SwitchScenes', () => {
			transitioning.value = false;
			this._updatePreviewScene();
			this._updateProgramScene();
		});

		this.on('ScenesChanged', () => {
			this._updateScenesList();
		});

		this.on('SourceCreated', () => {
			this._updateSourcesList();
		});

		this.on('SourceDestroyed', () => {
			this._updateSourcesList();
		});

		this.on('SourceRenamed', () => {
			this._updateSourcesList();
		});

		this.on('PreviewSceneChanged', data => {
			previewScene.value = {
				name: data['scene-name'],
				sources: data.sources
			};
		});

		this.on('TransitionBegin', data => {
			const toScene = previewScene.value ? previewScene.value.name : undefined;
			nodecg.sendMessage(`${namespace}:transitioning`, {
				sceneName: toScene,
				fromScene: programScene.value ? programScene.value.name : undefined,
				toScene,
				...data
			});
			transitioning.value = true;
		});

		this.on('StudioModeSwitched', data => {
			studioMode.value = data['new-state'];
		});

		setInterval(() => {
			if (websocketConfig.value && websocketConfig.value.status === 'connected' && !this._connected) {
				log.warn('Thought we were connected, but the automatic poll detected we were not. Correcting.');
				clearInterval(this._reconnectInterval!);
				this._reconnectInterval = null;
				this._reconnectToOBS();
			}
		}, 1000);
	}

	/**
	 * Attemps to connect to OBS Studio via obs-websocket using the parameters
	 * defined in the ${namespace}:websocket Replicant.
	 * @returns {Promise}
	 */
	_connectToOBS() {
		const websocketConfig = this.replicants.websocket;

		if (websocketConfig.value.status === 'connected') {
			return Promise.reject(new Error("Already connected! Cannot connect again."));
		} else if (websocketConfig.value.status === 'connecting') {
			return Promise.reject(new Error("Please wait! Connection already in progress!"));
		}

		websocketConfig.value.status = 'connecting';

		return this.connect({
			address: `${websocketConfig.value.ip}:${websocketConfig.value.port}`,
			password: websocketConfig.value.password,
			secure: websocketConfig.value.secure
		}).then(() => {
			websocketConfig.value.status = 'connected';
			this._fullUpdate();
			
			return Promise.resolve("OBS websocket sucessfully connected.");
		}).catch(() => {
			websocketConfig.value.status = 'error';	
		});
	}

	/**
	 * Disconnects from OBS Studio via obs-websocket.
	 * @returns {Promise}
	 */
	_disconnectFromOBS() {
		const websocketConfig = this.replicants.websocket;

		if (websocketConfig.value.status === 'disconnected') {
			return Promise.reject(new Error("Already disconnected! Cannot disconnect."));
		} else if (websocketConfig.value.status === 'connecting') {
			return Promise.reject(new Error("Connection in progress! Please wait before disconnecting."));
		}

		this.disconnect();
		websocketConfig.value.status = 'disconnected';
		
		return Promise.resolve("OBS websocket sucessfully disconnected.");
	}

	/**
	 * Attempt to reconnect to OBS, and keep re-trying every 5s until successful.
	 * @private
	 */
	_reconnectToOBS() {
		if (this._reconnectInterval) {
			return;
		}

		const websocketConfig = this.replicants.websocket;
		if (this._ignoreConnectionClosedEvents) {
			websocketConfig.value.status = 'disconnected';
			return;
		}

		websocketConfig.value.status = 'connecting';
		this.log.warn('Connection closed, will attempt to reconnect every 5 seconds.');
		this._reconnectInterval = setInterval(() => {
			this._connectToOBS().then(() => {
				clearInterval(this._reconnectInterval!);
				this._reconnectInterval = null;
			});
		}, 5000);
	}

	/**
	 * Gets the current scene info from OBS, and detemines what layout is active based
	 * on the sources present in that scene.
	 * @returns {Promise}
	 */
	_fullUpdate() {
		return Promise.all([
			this._updateScenesList(),
			this._updateSourcesList(),
			this._updateProgramScene(),
			this._updatePreviewScene(),
			this._updateStudioMode()
		]);
	}

	/**
	 * Updates the sceneList replicant with the current value from OBS.
	 * By extension, it also updates the customSceneList replicant.
	 * @returns {Promise}
	 */
	_updateScenesList() {
		return this.send('GetSceneList').then(res => {
			this.replicants.sceneList.value = res.scenes.map(scene => scene.name);
			return res;
		}).catch(err => {
			this.log.error('Error updating scenes list:', err);
		});
	}

	/**
	 * Updates the sourceList replicant with the current value from OBS.
	 * By extension, it also updates the customSourcesList replicant.
	 * @returns {Promise}
	 */
	 _updateSourcesList() {
		return this.send('GetSourcesList').then(res => {
			this.replicants.sourceList.value = res.sources.map(source => source.name);
			return res;
		}).catch(err => {
			this.log.error('Error updating sources list:', err);
		});
	}

	/**
	 * Updates the programScene replicant with the current value from OBS.
	 * @returns {Promise}
	 */
	_updateProgramScene() {
		return this.send('GetCurrentScene').then(res => {
			// This conditional is required because of this bug:
			// https://github.com/Palakis/obs-websocket/issues/346
			if (res.name && res.sources) {
				this.replicants.programScene.value = {
					name: res.name,
					sources: res.sources
				};
			}
			
			return res;
		}).catch(err => {
			this.log.error('Error updating program scene:', err);
		});
	}

	/**
	 * Updates the previewScene replicant with the current value from OBS.
	 */
	_updatePreviewScene() {
		return this.send('GetPreviewScene').then(res => {
			// This conditional is required because of this bug:
			// https://github.com/Palakis/obs-websocket/issues/346
			if (res.name && res.sources) {
				this.replicants.previewScene.value = {
					name: res.name,
					sources: res.sources
				};
			}
		}).catch(err => {
			if (err.error === 'studio mode not enabled') {
				this.replicants.previewScene.value = null;
				return;
			}

			this.log.error('Error updating preview scene:', err);
		});
	}

	/**
	 * Updates the studioMode replicant with the current value from OBS.
	 * @returns {Promise.<T>|*}
	 * @private
	 */
	_updateStudioMode() {
		return this.send('GetStudioModeStatus').then(res => {
			this.replicants.studioMode.value = res['studio-mode'];
		}).catch(err => {
			this.log.error('Error getting studio mode status:', err);
		});
	}

	/**
	 * Transitions from preview to program with the desired transition.
	 * Has an optional hook for overriding which transition is used.
	 * @param [transitionName] - The name of the transition to use.
	 * If not provided, will use whatever default transition is selected in this.
	 * The transition choice can be overridden by a user code hook.
	 * @param [transitionDuration] - The duration of the transition to use.
	 * If not provided, will use whatever default transition duration is selected in this.
	 * The transition duration can be overridden by a user code hook.
	 * @returns {Promise}
	 */
	async _transition(transitionName?: string, transitionDuration?: number) {
		if (this.replicants.websocket.value.status !== 'connected') {
			throw new Error('Can\'t transition when not connected to OBS');
		}

		const transitionConfig = {
			name: transitionName,
			duration: undefined
		} as {
			name: string;
			duration?: number;
		};

		if (typeof transitionDuration === 'number') {
			transitionConfig.duration = transitionDuration;
		}

		let transitionOpts = {
			'with-transition': transitionConfig
		};

		// Mark that we're starting to transition. Resets to false after SwitchScenes.
		this.replicants.transitioning.value = true;

		if (typeof this.hooks.preTransition === 'function') {
			const modifiedTransitionOpts = await this.hooks.preTransition(clone(transitionOpts));
			if (modifiedTransitionOpts) {
				transitionOpts = modifiedTransitionOpts;
			}
		}

		try {
			await this.send('TransitionToProgram', transitionOpts);
		} catch (e) {
			this.replicants.transitioning.value = false;

			// If we are able, add information about the name and duration of the transition we were trying
			// to invoke when the error happened.
			if (typeof e === 'object' && {}.hasOwnProperty.call(e, 'messageId') &&
				typeof transitionOpts === 'object' && typeof transitionOpts['with-transition'] === 'object') {
				e.name = transitionOpts['with-transition'].name;
				e.duration = transitionOpts['with-transition'].duration;
			}
			throw e;
		}
	}

	/**
	 * Clears the list of used namespaces, allowing any previously used
	 * namespace to be re-used. Used internally for testing, should
	 * not be used in production.
	 * @private
	 */
	static _clearUsedNamespaces() {
		return usedNamespaces.clear();
	}
}

/**
 * Calculates the absolute file path to one of our local Replicant schemas.
 */
function buildSchemaPath(schemaName: string) {
	return path.resolve(__dirname, '../schemas', `${encodeURIComponent(schemaName)}.json`);
}
