#!/bin/bash
# Paste the local clipboard content to SimpleBin (macOS).
#
# v2 note: $TOKEN must be a per-user API token, generated on the Settings page
# of the web UI (shown only once — store it in your password manager).
# The old single shared TOKEN no longer works.
clip_content="$(pbpaste)"
content_type="Content-Type: text/plain"
auth_header="Authorization: Bearer $TOKEN"
curl --location 'https://bin.youjf.com/' --header "$auth_header" --header "$content_type" --data "$clip_content"
