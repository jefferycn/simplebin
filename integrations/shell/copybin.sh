#!/bin/bash
clip_content="$(pbpaste)"
content_type="Content-Type: text/plain"
auth_header="Authorization: Bearer $TOKEN"
response=$(curl --location 'https://bin.youjf.com/plain' -s --header "$auth_header" --header "$content_type")
echo "$response" | pbcopy
