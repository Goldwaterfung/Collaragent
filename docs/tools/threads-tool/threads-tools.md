# Expanded Threads API Documentation

## Overview
The Threads API, part of Meta's developer tools, enables developers to publish and manage content on Threads, including posts, replies, quotes, and more. It supports various media types such as text, images, videos, and carousels. Key features include creating posts, retrieving media objects, managing replies, handling quotes, adding spoilers, deleting posts, performing keyword searches, and retrieving mentions.

### Requirements
- A Threads account linked to the API.
- Access tokens generated via the Graph API Explorer for testing.
- Publicly accessible URLs for images and videos (must be cURL-able by the API).

### Permissions
- `threads_basic`: Required for all Threads API endpoints.
- Additional permissions for specific features:
  - `threads_manage_replies`: For managing replies.
  - `threads_keyword_search`: For keyword searches (limits to own posts if not approved; public posts after approval).
  - `threads_manage_mentions`: For mentions (limits to tester mentions if not approved; public after).
  - `threads_delete`: For deleting posts.

### Rate Limits
- Posting: 250 posts per profile per 24 hours (carousels count as 1).
- Deletes: 100 per day per account.
- Keyword Search: 2,200 queries per user per 24-hour rolling period (non-empty results only; repeated queries count; offensive keywords return empty but don't count).
- Mentions: Not specified.

### General Limitations
- Text: ≤500 characters (emojis by UTF-8 bytes).
- Media must meet specifications (detailed below).
- Sensitive/offensive content handling varies by endpoint.

## Managing Posts

### Creating Posts
Posts can be single threads (text, image, video) or carousels (up to 20 items). Process: Create media container(s), then publish.

#### Single Thread Posts
1. **Create Media Container**  
   Endpoint: `POST /{threads-user-id}/threads`  

   Parameters:  

   | Name | Type | Required | Description |
   |------|------|----------|-------------|
   | `media_type` | string | Yes | `TEXT`, `IMAGE`, or `VIDEO` |
   | `text` | string | Yes (for TEXT) | Post text; first URL auto-used for preview |
   | `image_url` | URL | Yes (for IMAGE) | Public URL |
   | `video_url` | URL | Yes (for VIDEO) | Public URL |
   | `is_carousel_item` | Boolean | No | False for single (default) |
   | `access_token` | string | Yes | Authentication |

   Example:  
   ```bash
   curl -i -X POST \
     -d "media_type=IMAGE" \
     -d "image_url=<IMAGE_URL>" \
     -d "text=<TEXT>" \
     -d "access_token=<ACCESS_TOKEN>" \
   "https://graph.threads.net/v1.0/<THREADS_USER_ID>/threads"
   ```  
   Response: `{ "id": "<MEDIA_CONTAINER_ID>" }`

2. **Publish Container**  
   Endpoint: `POST /{threads-user-id}/threads_publish`  

   Parameters:  

   | Name | Type | Required | Description |
   |------|------|----------|-------------|
   | `creation_id` | int | Yes | Container ID |
   | `access_token` | string | Yes | Authentication |

   Example:  
   ```bash
   curl -i -X POST \
     -d "creation_id=<MEDIA_CONTAINER_ID>" \
     -d "access_token=<ACCESS_TOKEN>" \
   "https://graph.threads.net/v1.0/<THREADS_USER_ID>/threads_publish"
   ```  
   Response: `{ "id": "<PUBLISHED_MEDIA_ID>" }`  

   Note: Wait ~30 seconds for processing. Check media container status if needed.

#### Carousel Posts
1. **Create Individual Items**  
   Same as single, but set `is_carousel_item=true`. Repeat for 2–20 items (IMAGE/VIDEO only).  

2. **Create Carousel Container**  
   Endpoint: `POST /{threads-user-id}/threads`  

   Parameters:  

   | Name | Type | Required | Description |
   |------|------|----------|-------------|
   | `media_type` | string | Yes | `CAROUSEL` |
   | `children` | list<int> | Yes | Comma-separated item IDs (2–20) |
   | `text` | string | No | Optional text |
   | `access_token` | string | Yes | Authentication |

   Example:  
   ```bash
   curl -i -X POST \
     -d "media_type=CAROUSEL" \
     -d "children=<MEDIA_ID_1>,<MEDIA_ID_2>..." \
     -d "access_token=<ACCESS_TOKEN>" \
   "https://graph.threads.net/v1.0/<THREADS_USER_ID>/threads"
   ```  
   Response: `{ "id": "<CAROUSEL_CONTAINER_ID>" }`

3. **Publish Carousel**  
   Same as single publish. Counts as one post.

#### Additional Post Features
- **Topic Tags**:  
  - Parameter: `topic_tag` (1–50 chars, no `.` or `&`).  
  - Or in-text `#tag` (legacy: no spaces/punctuation, one per post).  
  Example: Add `-d "topic_tag=<TAG>"` to create request.

- **Links**: Text-only.  
  - Parameter: `link_attachment` (explicit URL).  
  - Or first URL in `text`.  
  Limitations: Max 5 unique links; fails if exceeded (after Dec 22, 2025).  
  Example: Add `-d "link_attachment=<URL>"`.

- **GIFs**: Text-only, Tenor provider.  
  Parameter: `gif_attachment` = `{ "gif_id": "<GIF_ID>", "provider": "TENOR" }`.  
  Example: Add `-d 'gif_attachment={"gif_id":"<GIF_ID>","provider":"TENOR"}'`.

#### Media Specifications
- **Images**: JPEG/PNG, ≤8MB, aspect ≤10:1, width 320–1440px, sRGB.  
- **Videos**: MOV/MP4, ≤1GB, ≤300s, ≤1920px width, aspect 0.01:1–10:1, FPS 23–60, bitrate ≤100Mbps video/128kbps audio, AAC audio.

### Retrieving Posts
Endpoints: `GET /threads` or `GET /{threads_media_id}`.  

Fields: `id`, `link_attachment_url`, `text`, `media_type`, `permalink`, `timestamp`, `username`, `has_replies`, `is_quote_post`, `is_reply`, etc. (Note: `owner` excluded).  

Example:  
```bash
curl -s -X GET \
"https://graph.threads.net/v1.0/<THREADS_MEDIA_ID>?fields=id,link_attachment_url&access_token=<ACCESS_TOKEN>"
```  
Response: `{ "id": "<ID>", "link_attachment_url": "<URL>" }`

## Creating Replies
Replies target a root post or specific reply. Requires ownership of root or `threads_keyword_search`/`threads_manage_mentions`.

1. **Create Reply Container**  
   Endpoint: `POST /me/threads`  

   Parameters:  
   | Name | Type | Required | Description |
   |------|------|----------|-------------|
   | `media_type` | string | Yes | `TEXT`, `IMAGE`, `VIDEO` |
   | `text` | string | No | Reply text |
   | `reply_to_id` | int | Yes | ID of post/reply to respond to |
   | `access_token` | string | Yes | Authentication |

   Example:  
   ```bash
   curl -X POST \
     -F "media_type=<MEDIA_TYPE>" \
     -F "text=<TEXT>" \
     -F "reply_to_id=<THREADS_ID>" \
     -F "access_token=<ACCESS_TOKEN>" \
   "https://graph.threads.net/v1.0/me/threads"
   ```  
   Response: `{ "id": "<CONTAINER_ID>" }`

2. **Publish Reply**  
   Endpoint: `POST /{threads-user-id}/threads_publish`  

   Parameters: Same as post publish. Wait ~30 seconds.

## Quote Posts
Add `quote_post_id` to media creation for quoting.

Example Create:  
```bash
curl -i -X POST \
  "https://graph.threads.net/v1.0/<THREADS_USER_ID>/threads?media_type=IMAGE&image_url=https://www.example.com/images/bronz-fonz.jpg&text=BronzFonz&access_token=<ACCESS_TOKEN>" \
  -d quote_post_id="1234567"
```  
Response: `{ "id": "<CONTAINER_ID>" }`

Retrieve: Use fields `is_quote_post`, `quoted_post`.  

Example:  
```bash
curl -s -X GET \
  "https://graph.threads.net/v1.0/<THREADS_MEDIA_ID>?fields=id,is_quote_post,quoted_post&access_token=<ACCESS_TOKEN>"
```  
Response: `{ "id": "<ID>", "is_quote_post": true, "quoted_post": { "id": "<QUOTED_ID>" } }`

## Spoilers in Posts
Add to text (≤10 entities) or media (IMAGE/VIDEO/CAROUSEL).

- **Text Spoilers**: Parameter `text_entities` = list of `{ "entity_type": "SPOILER", "offset": int, "length": int }`.  
- **Media Spoilers**: Parameter `is_spoiler_media` = true (applies to all in carousel).

Examples for single/carousel in creation step (add to container requests).  

Limitations: Media spoilers only for specified types; max 10 text entities.

## Deleting Posts
Endpoint: `DELETE /{threads-media-id}`  

Parameters: `access_token`.  

Example:  
```bash
curl -i -X DELETE \
  "https://graph.threads.net/v1.0/<THREADS_MEDIA_ID>?access_token=<ACCESS_TOKEN>"
```  
Response: `{ "success": true, "deleted_id": "<ID>" }`

## Keyword Search
Endpoint: `GET /keyword_search`  

Parameters:  

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | Yes | Keyword(s)/tag |
| `search_type` | string | No | `TOP` (default) or `RECENT` |
| `search_mode` | string | No | `KEYWORD` (default) or `TAG` |
| `media_type` | string | No | `TEXT`, `IMAGE`, `VIDEO` |
| `since` | string | No | Start timestamp (≥1688540400, < until) |
| `until` | string | No | End timestamp (≤ now, > since) |
| `limit` | int | No | Max results (default 25, ≤100) |
| `author_username` | string | No | Exact username filter (no @) |
| `fields` | string | No | Comma-separated fields |

Example:  
```bash
curl -s -X GET \
  -F "q=example" \
  -F "search_type=TOP" \
  -F "fields=id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply" \
  -F "access_token=<TOKEN>" \
"https://graph.threads.net/v1.0/keyword_search"
```  
Response: Array of media objects.

Also: Retrieve recently searched keywords via `GET /me?fields=recently_searched_keywords`.

## Threads Mentions
Endpoint: `GET /{threads-user-id}/mentions`  

Parameters: `fields` (comma-separated, e.g., from threads-media fields), `since`, `until`, `access_token`.  

Example:  
```bash
curl -s -X GET \
  "https://graph.threads.net/<THREADS_USER_ID>/mentions?fields=<LIST_OF_FIELDS>&access_token=<ACCESS_TOKEN>"
```  
Response: JSON with media objects where the profile is tagged (public only).

Limitations: No private media; timestamp constraints as above.