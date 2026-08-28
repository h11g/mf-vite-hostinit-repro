import { instanceId } from 'shared-lib';
import * as leaf from 'leaf/x';

export function probe() {
	return instanceId;
}

export function leafInstanceId() {
	return leaf.leafId;
}
