json or yaml

config.yaml:

users:
  name: password
  name: password
  name: password
  name: password

# these teachers can take over control
# and force all other to follow-live with a toggle
teachers:
    name1, name2

defaults:
    workspcae_timeout_secs: 600
    
workspaces:
  name:
    timeout?: 
    path:
    lsp:

If there is no workspace configured the default is

workspaces:
    default:
    path: ./
    lsps: defaults


Now if config.yaml is writable/readable by users or a special secure user ?
For now one user kinda sucks but is good enough. Config can instead be passed on stdin
(source `-`) so a secure launcher/parent process supplies it without making the file
world-readable or world-writable. That is intentional and meant for people/operators
who take control of how wede is launched.

./server --configs users:cached:- --configs users,teachers:hot:foo.json --configs workspaces:hot:bar.json

That then means waslk the arguments, build a list
keys,hot|cached,source

When listing workspaces or looking up passwords the list must be walked
backwards: workspaces  get merged, users gets merged.
From the result the workspace list or password is derived.
if hot the file gets reloaded.

Thus when sohwing the workspace selector at client side it gets a fresh view
cause the server is asked what workspaces exist ?

PASSWORD: clear text or sha256 of the password ( printf %s 'secret' | sha256sum )

THUS LOGIN:

username/password -> complete -> show workspaces
[drop down] [name] [join]

the drop down showns
1) active sessions
2) the workspace templates
   when selecting one the name by default is the workspace name

So the drop down looks like this:

workspacename:name (users | age) <- users -> number users, age -> how long it has been running
workspacename:name (new) (for allowing to connect to same workspace but with new session name)
....

Thus switching a workspace from then on is like logging in again, without having to
type the password: the authenticated client just picks another active session or template.


TEACHER
If you're a teacher you can take the lead meaning all others are forced into
follow-live mode. The toggle is in the hamburger menu

FOLLOWING
Peolpe can click on another person and get a popup 'follow-open follow-live'
where follow-open opens the tabs, where follow-live follows the cursor position.
So they can opt-in to it. The TEACHER mode is forced.
THus teacher mode "overwrites" the following.
json or yaml

config.yaml:

users:
  name: password
  name: password
  name: password
  name: password

# these teachers can take over control
# and force all other to follow-live with a toggle
teachers:
    name1, name2

defaults:
    workspcae_timeout_secs: 600
    
workspaces:
  name:
    timeout?: 
    path:
    lsp:

If there is no workspace configured the default is

workspaces:
    default:
    path: ./
    lsps: defaults


Now if config.yaml is writable/readable by users or a special secure user ?
For now one user kinda sucks but is good enough. Config can instead be passed on stdin
(source `-`) so a secure launcher/parent process supplies it without making the file
world-readable or world-writable. That is intentional and meant for people/operators
who take control of how wede is launched.

./server --configs users:cached:- --configs users,teachers:hot:foo.json --configs workspaces:hot:bar.json

That then means waslk the arguments, build a list
keys,hot|cached,source

When listing workspaces or looking up passwords the list must be walked
backwards: workspaces  get merged, users gets merged.
From the result the workspace list or password is derived.
if hot the file gets reloaded.

Thus when sohwing the workspace selector at client side it gets a fresh view
cause the server is asked what workspaces exist ?

PASSWORD: clear text or sha256 of the password ( printf %s 'secret' | sha256sum )

THUS LOGIN:

username/password -> complete -> show workspaces
[drop down] [name] [join]

the drop down showns
1) active sessions
2) the workspace templates
   when selecting one the name by default is the workspace name

So the drop down looks like this:

workspacename:name (users | age) <- users -> number users, age -> how long it has been running
workspacename:name (new) (for allowing to connect to same workspace but with new session name)
....

Thus switching a workspace from then on is like logging in again, without having to
type the password: the authenticated client just picks another active session or template.


TEACHER
If you're a teacher you can take the lead meaning all others are forced into
follow-live mode. The toggle is in the hamburger menu

FOLLOWING
Peolpe can click on another person and get a popup 'follow-open follow-live'
where follow-open opens the tabs, where follow-live follows the cursor position.
So they can opt-in to it. The TEACHER mode is forced.
THus teacher mode "overwrites" the following.
