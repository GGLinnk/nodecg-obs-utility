/* tslint:disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

export type ProgramScene = null | {
	name: string;
	sources: {
		alignment?: number;
		cx: number;
		cy: number;
		id: number;
		locked: boolean;
		muted?: boolean;
		name: string;
		render: boolean;
		source_cx: number;
		source_cy: number;
		type: string;
		volume: number;
		x: number;
		y: number;
		parentGroupName?: string;
		groupChildren?: unknown[];
	}[];
};
