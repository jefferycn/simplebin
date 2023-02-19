#!/bin/bash
clip_content="$(pbpaste)"
content_type="Content-Type: text/plain"
auth_header="Authorization: Bearer $TOKEN"
curl --location 'https://bin.youjf.com/' --header "$auth_header" --header "$content_type" --data "$clip_content"
