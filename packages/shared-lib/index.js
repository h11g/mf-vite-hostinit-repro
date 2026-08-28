// One evaluation == one instance id. Two ids on the page == duplicated singleton.
export const instanceId = 'shared-lib#' + Math.random().toString(36).slice(2, 8);
console.log('[shared-lib] evaluated ->', instanceId);
