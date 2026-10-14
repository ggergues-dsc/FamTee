// View preferences remembered per browser (not part of the family): the detail panel's
// collapsed state and View/Edit mode, and which badges the cards show.

const KEY = 'famtee:panel'; // name kept from when it held only the panel's choices

// The stored choices as view properties, with defaults for anything missing or unreadable.
export function loadViewPrefs(storage) {
  let prefs = {};
  try {
    prefs = JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {};
  } catch {
    // unreadable: use the defaults
  }
  return {
    panelCollapsed: prefs.collapsed === true,
    panelMode: prefs.mode === 'view' ? 'view' : 'edit',
    showFlags: prefs.flags !== false,
    showJobs: prefs.jobs !== false,
  };
}

export function saveViewPrefs(storage, view) {
  try {
    storage?.setItem(KEY, JSON.stringify({
      collapsed: view.panelCollapsed, mode: view.panelMode, flags: view.showFlags, jobs: view.showJobs,
    }));
  } catch {
    // storage full or blocked: the choice just isn't remembered
  }
}
