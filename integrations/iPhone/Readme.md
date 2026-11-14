## Using SimpleBin on an iOS device

**v2 note — these Shortcuts are legacy.** The official client in v2 is the web
page: open SimpleBin in Safari and use "Add to Home Screen". It covers paste,
copy-latest, history, and file/image upload, without the Shortcuts bugs.

The Shortcuts below still work against the v2 API, but the token changed: use
a per-user API token generated on the Settings page of the web UI (shown only
once), not the old single shared TOKEN. Put the new token in the shortcut's
Text field, replacing the old one — copy the full token (`sb_` + 32 chars);
the list on the Settings page only shows a prefix, which won't work.
The Authorization header may carry the token with or without the `Bearer `
prefix, as in v1. Also remember to change the hostname.
`/{id}` and `/{id}/json` also work again, but now require the Bearer token
and only return the token owner's own items.

Here's the example of using Shortcuts to paste data to SimpleBin.

https://www.icloud.com/shortcuts/722b56a9025f45378ee896912579b847

Here's an example for copying data from SimpleBin.

https://www.icloud.com/shortcuts/370701ac3ee34738ac67a3d19c96414d

Here's another example for copying curring message permanent link.

https://www.icloud.com/shortcuts/4cd79426f0104dc4b0965bb8fccadb50
