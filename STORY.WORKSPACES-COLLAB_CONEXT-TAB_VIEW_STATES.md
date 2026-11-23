design-goals:
- allow single user, small groups, 10000 + mass presentations
  without breaking down
- teacher mode
- collaborative conexts poeple can watch and follow each other
- shared perisistant terminals to keep ai agents running
    workspace:collab_session:directory (tab_session)
    workspace: the defaults from config
    collab_session (old session): The session within which users can see each other
    -> those together are a "server state"
        tab_session: an opened tab by a user - can have multiple.
        To keep simple the default behavior is to 'use-here' thus take over
        when switching tabs


workspace:collab_session[:directory] tab_view_state
  workspace:collaboration_context[:directory] is the backend_session_key

  workspace: controls who can login, base directory and settings
  workspace:session_name
        The session_name's default is the workspace. It controls who can collaborate on open files and follow each other
        join same session_name to collaborate in a group

        directory -> what base directory to show

  tab_view_state: What is visible in a tab

  A session controls what terminals eg are open (server state)
  If a sesison is closed, the terminals are closed and the shared
  session state is lost. Thus close belows closes the state


BACKEND_SERVER_SIDE:

workspace:collaboration_context[:directory] is the backend_session_key 

# backend session state
BACKEND_SESSIONS = {
    KEY (workspace:collaboration_context[:directory]): {

        cursor states for collaborative editing etc
        next_term_id: ...

        terminal_server_states: {
            "term1": { start_date : .. terminals have shared server state they run on the server anyway }
            "term2": { ... }
        }

        tab_sessions = [
            # while user can collaborate and see who has opened what files
            # they of course can't pick each others sessions or close each
            # others sessions

            "user:name": {

                tab_category_visibilities: {
                    files: true/false
                    search: true/false
                    ...
                }

                # full dump of layout, but not content state, for that see tab_content_states
                layout: LAYOUT_STATE

                # each time layout position changes it can be updated here
                tab_content_states: [
                    "tabid": cursor location / selection of user
                    each tab (eg also multiple views of the same files)
                    gets a unique id so that it can be associated and its state can be tracked
                ]

                -> the containers store the open tabs (order) tab type and top
                scroll positoin (PDF, text files)
            }
        ]
    }
}


LOGIN WORKFLOW & STATES

all session state is stored on the server except the
window.sessionStorage.tab_view_state so that it can be reconstructed

Whenever the view state is changed

    - visibility of tab categories

    - tab placements (main container with attached containers and floating containers)

    -> send full dump of it to the server so that the consistent state is on the
       server

    thus when logging in and state exsists the full dump can get reconstructed



1) LOGIN

2) If in window.sessionStorage (the tab) there is a registered tab_view_state
   and its not used its claimed. Otherwise the workspace / session
   selection form shows up.

3) when reconnecting (loading the page)

  when taking over an existing session the server dumps the layout
  states etc. -> initialize_client_ide_workspace_state

  All important information about opened files (session tab) 
  etc gets resynced so its never out of date and a consistent state is reached.
  Because the server has knowledge of the containers and tab placements
  a session can be roughly reconstructed

  This all is a mess because:
  - users can login multiple times using same name
  - mutiple users can login
  -> users should be allowd to >join< others or do their own stuff
  -> the idea was to have the server know about all terminals,
  and allow to 'see all terminals'

  Even the same browser can have multiple tabs ?
  So what's visible is 'tab state'
  So what's loaded is "session state'

  now if you have tab1, tab2 and then login again what should happen?
  if tab2 is opened ask to cerate "new view" or to take over tab1 ?
  if new view it means the device has 2 view states which can be selected from?
  Thus opening tab 3 then lists take over tab1 or tab2 or start new (3rd)?
  Thus if we give each device a random id the server could store the states:
  "worskpace:session_name:directory", device, tab_session
  and if user logs in all sessions can be shown to continue even when switching
  the device? new tab_session can be given a name or autoinc number as fallback.

  does the "tab_session" depend on session_name ? The session_name basically is a
  collaboration_context_name ..

  So login is like:

    tab_view_state_selector: (expandable)
      this workspace has the following tab_view_states:
        NEW !!! of course only the tab sessions of the same sure should be listed here
          "1" (connected): [use-here] [clone] [close-remove]
          "ses-on-mobile": [use-here] [clone] [close-remove]
      create new [name here autoinc id 2 would be next] [enter]

    Should behave like this:
    the first tab state [use-here] should be the default (highlighted).
    The others can be clicked/used
    then the [enter] in hidden state is the most simple default:
    Allow to use a state on one device only.


  connected means a socket connection is active thus [use-here] would disconnect the other

  Maybe use separate get parameters
      ?workspace=
      ?sessionname= (should rename to collaboration_context)
      ?tab_view_state=

  Meaning the modal workspace selector then looks like this:
    [ close current ] if there is a current

    workspace [ choose ] 
    collab_context: [ name ] default is the workspace name
    tab_view_state_selector inputs from above
    [enter] [cancel] [logout] [close all tab states and logout]

    cancel in case of workspace switching.

    thus the global view state is liek
    {
        workspace?:
        modal: [ ChooseWorkspaceAndTabSession, show-cancel=true/false ]
    }

  ----
 show this in hamburger menu:
  workspace:session_name
  directory (tab_session)
  -> when clicked show modal window
  --------
  Logout (does not close)

for each tab_view_state a user can open a file multiple times
which yields multiple curser positions which can be shared.
So you have collaborative behavior within one tab ?
However teacher force follow and open files will always activate the existing
tab for now to keep it simple. The file popup can get a "additional view |
selected " entry to open multiple times.

Closing behavior:
    terminal: hide -> only stops showing
    close: server rejects the "close" if there are other users then it turns into a hide

Locking turns into
    [x] prevent_hide (tab_session state, thus part of the tab_session state submitted to server)
    [x] prevent_close (no user can close it by accident, eg terminal) -> shared state
Thus the tab menus locking turns into 2 flags.

An additional tab "session-tabs"
shows all opened tabs so that you can join other people.
Beacuse a tab now is either closed (gone, no more state),
hidden: its state is preserved, see above, or visible (shown
in the UI). See BACKEND_SERVER_SIDE -> # backend session state

F5/Reloading: because the last selected tab_view is stored in
sessionState the page must
- ask server is the session used (because the socket connection is gone server should say no)
- should claim it
If its used the session selector should be shown.


SESSION TABS

    And the session tab list should be very very simple:

    tab1 (N) [user list]
    tab2 (N) [user list]
    tab3 (N) [user lits]
    term1 
    term2
    term3

    N => how often its opened in this tab view

    If there are less than 3 users the users list should be the names, otherwise the number of people.

    clicking:
        for terminals: toggles whether its shown. showin means (activate move to front)
        for files: 
            clicking file name:
                 activates it (first if there are multi views)
            clicking the user name -> opens where the user has opened it (scroll location)
            if more than 3 users -> shows popup.

     





initialize_client_ide_workspace_state = (server_initialization_state or null) => {
  if there is data from server state
  {
    one setState call setting the layout
  } else {
    one reset_view call
    one send_layout to server call
  }
}

workspace( = ide stae) = {
  state_by_tab_id = {
  }
  layout = {
    the nested layout with width/height locations etc.
  }
}

The send_layout sends portrait/landscape is mobile width/height
-> when restoring if that "screen identity" is broken
restores the windows with sane defaults. widthg/height
position of floating within the visible area etc.




LAYOUT_STATE:

 We have sending the following states
 - submit cursor location/scroll pos for current tab
   -> so others can follow
 - submit full layout as JSON recursive

   the layout should look like this:

   {
     next_tab_id: 10,
     focused_tab_id
     floating: [
           {top, left, width, height, container},
           ...
        ]
     main = container
   }

and the container type is

{

     selected_tab: 4 (4th tab)

     tabs: [
        {id: , type: "term", name: "term02", dim: [w,h] },
        {id: , type: "file", name: "file.txt", dim: [w,h] },
        {id: , type: "settings", dim: [w,h] },
     ]

     attached: {
        left:   { width: ,  container: }
        bottom: { height: , container }
        right:  { width: , container }
     }
}


FOLLOW_EVENTS:
The layout is simple, see above, can be sent as is
The follow notifications (cursor and scroll location) then can be sent as
{id: ..., 'type': term, name: "...", "event_type": "cursor_location": .. cursor location ..}
{id: ..., 'type': term, name: "...", "event_type": "focused"} # focusing a window
....
the server can keep that in the tab_content_states ...
And when distributing the events to the listeners the can strip the id,
find their own id to follow. So if the sender uses 2 tabs showing the same file
the following persor doens't notice that.


{{{  mithril like global state abusing REACT to get rid of all bugs


I WAN THIS:
{
  socket: ..
  workspace: {
    settings
    ide_layout: ..
    null or workspace state
  }
  modal: null or modal window
}

the workspace state is

{
  the layout
}

that all is useState from react.
If it changes *EVERYTHING RENDERS*
I give a shit like mithnril I wan tworking code finally.


so teh session switcher bascially sets the socket
and sets up the socket handler.
then if th efirst message is reicved
th worskpace state is ASSIGNED ONCE AN DONE

How to restorte the layout state ?

<IDE layout={state.workspace.ide_layout} </IDE>

Now the ideo walks the containers of the state to call the containers 
recursively


IDE COMPONENT:

<div>
  <hamburher menu/> // overs all !

  <FloatingContainer/> // hovers the main container

  // main container with nested
  <COntainer main=true/false state={the recursive state}/>
</div>


Container = {state} => {
  renedr tabs
  render main content area
  render the resizing stuff ...
  render left
  bottom right
}

-> DONE

}}}

