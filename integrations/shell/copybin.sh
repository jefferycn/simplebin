#!/bin/bash
# Copy the latest item from SimpleBin into the local clipboard (macOS).
#
# v2 note: $TOKEN must be a per-user API token, generated on the Settings page
# of the web UI (shown only once — store it in your password manager).
# The old single shared TOKEN no longer works.
content_type="Content-Type: text/plain"
auth_header="Authorization: Bearer $TOKEN"
response=$(curl --location 'https://bin.youjf.com/plain' -s --header "$auth_header" --header "$content_type")
echo "$response" | pbcopy
