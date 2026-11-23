export interface SessionChoice {
  workspaceId: string | null
  collabContext: string
  tabViewState: string
  // force asks the next page load to skip the "is this state connected
  // elsewhere?" check and take the state over. Used by [use-here] and by an
  // explicit selection in the chooser.
  force?: boolean
}

// The chosen view state is tab-local: sessionStorage is per browser tab, so
// another tab can use a different state without the two fighting over one.
const TAB_VIEW_STATE_KEY = 'wede_tab_view_state'

export function rememberTabViewState(name: string): void {
  const tv = name.replace(/^user:/, '')
  try {
    if (tv) sessionStorage.setItem(TAB_VIEW_STATE_KEY, tv)
    else sessionStorage.removeItem(TAB_VIEW_STATE_KEY)
  } catch { /* ignore */ }
}

export function rememberedTabViewState(): string | null {
  try { return sessionStorage.getItem(TAB_VIEW_STATE_KEY) } catch { return null }
}

// sessionUrl rewrites the workspace/session query parameters while preserving
// the rest of the URL. tab_view_state is stored without the "user:" prefix.
export function sessionUrl(choice: SessionChoice): string {
  const params = new URLSearchParams(window.location.search)
  if (choice.workspaceId) params.set('workspace', choice.workspaceId)
  else params.delete('workspace')
  params.delete('name')
  if (choice.collabContext) params.set('collab_context', choice.collabContext)
  else params.delete('collab_context')
  const tv = choice.tabViewState.replace(/^user:/, '')
  if (tv) params.set('tab_view_state', tv)
  else params.delete('tab_view_state')
  params.delete('takeover')
  if (choice.force) params.set('takeover', '1')
  const qs = params.toString()
  return `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
}

// navigateToSession applies a choice by reloading: workspace/context/tab state
// are all read once at startup, so a full reload is the reliable way to switch.
export function navigateToSession(choice: SessionChoice): void {
  rememberTabViewState(choice.tabViewState)
  window.location.assign(sessionUrl(choice))
}
