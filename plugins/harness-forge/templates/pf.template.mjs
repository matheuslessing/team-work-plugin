export const meta = {
  id: 'pf-<name>',
  version: '1.0.0',
  event: 'PreToolUse'
};

export function should_activate(state, action) {
  return Boolean(action?.tool);
}

export function intervene(state, action) {
  return { type: 'NOOP' };
}
