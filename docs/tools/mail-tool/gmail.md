# JavaScript Quickstart

Create a JavaScript web application that makes requests to the Gmail API.

This quickstart shows you how to set up and run an application that calls Google Workspace APIs.  
It uses a simplified authentication method suitable for **testing environments**.  
For **production environments**, we recommend that you first read about [Authentication and Authorization](https://developers.google.com/workspace/workspace/guides/auth-overview), and then [choose the appropriate type of credentials for your application](https://developers.google.com/workspace/workspace/guides/create-credentials).

This quickstart uses the API client library recommended by Google Workspace, which handles some of the details of the authentication and authorization flow.

## Objectives

- Set up the environment
- Set up the sample
- Run the sample

## Prerequisites

- Node.js and npm installed
- A Google Cloud project
- A Google account with Gmail enabled

## Set up your environment

To complete this quickstart, you need to prepare your environment.

### Enable the API

Before you can use Google APIs, you must enable them in your Google Cloud project.  
You can enable one or more APIs in a single Google Cloud project.

- In the Google Cloud Console, [enable the Gmail API](https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com).

### Configure the OAuth consent screen

If you're using a **new** Google Cloud project for this quickstart, configure the OAuth consent screen.  
If you have already done this for the project, skip to the next section.

1. In the Google Cloud Console, go to Menu → **Google Auth platform** → **Branding**.  
   [Go to Branding](https://console.cloud.google.com/auth/branding)

2. If you have already configured Google Auth platform, you can configure the following OAuth consent screen settings under **Branding**, **Audience**, and **Data access**.  
   If you see a message that **Google Auth platform has not been configured**, click **Get Started**:

   1. Under **App information** → **App name**, enter a name for the application.
   2. Under **User support email**, select a support email address so users can contact you if they have questions about consent.
   3. Click **Next**.
   4. Under **Audience**, select **Internal**.
   5. Click **Next**.
   6. Under **Contact information**, enter an **email address** where you can receive notifications about project changes.
   7. Click **Next**.
   8. In the **Done** section, review the Google API Services User Data Policy, and if you agree, select **I agree to the Google API Services: User Data Policy**.
   9. Click **Continue**.
   10. Click **Create**.

3. For now, you can skip the step of adding scopes.

   Later, if you create an app for users outside your Google Workspace organization, you must change **User type** to **External**, and then add the authorization scopes required by the app.  
   For more information, see the full [Configure OAuth consent](https://support.google.com/cloud/answer/10311615) guide.

### Authorize credentials for a web application

To authenticate end users and access user data in your app, you need to create one or more OAuth 2.0 Client IDs.  
The Client ID is used to identify a single application to Google's OAuth servers.  
If your application runs on multiple platforms, you must create a separate Client ID for each platform.

1. In the Google Cloud Console, go to Menu → **Google Auth platform** → **Clients**.  
   [Go to Clients](https://console.cloud.google.com/auth/clients)

2. Click **Create Client**.
3. Click **Application type** → **Web application**.
4. In the **Name** field, enter a name for the credential. This name is only shown in the Google Cloud Console.
5. Add authorized URIs related to your application:
   - **Client application (JavaScript)** — Under **Authorized JavaScript origins**, click **+ Add URI**.  
     Then enter the URI(s) used for browser requests. This identifies the domains from which your application can send API requests to the OAuth 2.0 server.
   - **Server-side application (Java, Python, etc.)** — Under **Authorized redirect URIs**, click **+ Add URI**.  
     Then enter an endpoint URI to which the OAuth 2.0 server can send responses.
6. Click **Create**.

The newly created credentials appear under **OAuth 2.0 Client IDs**.

**Record the Client ID**. (Client Secret is not used for web applications.)

Keep these credentials handy — you will need them later in this quickstart.

### Create an API key

1. In the Google Cloud Console, go to Menu → **APIs & Services** → **Credentials**.  
   [Go to the Credentials page](https://console.cloud.google.com/apis/credentials)

2. Click **Create Credentials** → **API key**.
3. Your new API key is displayed.
   - Click the copy icon to copy the API key so you can use it in your application code.  
     You can also find the API key later in the "API keys" section of the project's credentials.
   - To prevent unauthorized use, we recommend you restrict the API key by location and API.  
     See [Add API restrictions](https://developers.google.com/workspace/workspace/guides/api-keys#add-api-restrictions) for more information.

## Set up the sample

NodeJS version:

1. In your working directory, create a js file.
```javascript
import path from 'node:path';
import process from 'node:process';
import {authenticate} from '@google-cloud/local-auth';
import {google} from 'googleapis';

// The scope for reading Gmail labels.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The path to the credentials file.
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Lists the labels in the user's account.
 */
async function listLabels() {
  // Authenticate with Google and get an authorized client.
  const auth = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  // Create a new Gmail API client.
  const gmail = google.gmail({version: 'v1', auth});
  // Get the list of labels.
  const result = await gmail.users.labels.list({
    userId: 'me',
  });
  const labels = result.data.labels;
  if (!labels || labels.length === 0) {
    console.log('No labels found.');
    return;
  }
  console.log('Labels:');
  // Print the name of each label.
  labels.forEach((label) => {
    console.log(`- ${label.name}`);
  });
}

await listLabels();
```

HTML version:

1. In your working directory, create an html file.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Gmail API Quickstart</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <p>Gmail API Quickstart</p>

    <!--Add buttons to initiate auth sequence and sign out-->
    <button id="authorize_button" onclick="handleAuthClick()">Authorize</button>
    <button id="signout_button" onclick="handleSignoutClick()">Sign Out</button>

    <pre id="content" style="white-space: pre-wrap;"></pre>

    <script type="text/javascript">
      /* exported gapiLoaded */
      /* exported gisLoaded */
      /* exported handleAuthClick */
      /* exported handleSignoutClick */

      // TODO(developer): Replace with client ID and API key from the Developer Console
      const CLIENT_ID = '<YOUR_CLIENT_ID>';
      const API_KEY = '<YOUR_API_KEY>';

      // Discovery doc URL for APIs used by the quickstart
      const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';

      // Authorization scopes required by the API; multiple scopes can be
      // included, separated by spaces.
      const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

      let tokenClient;
      let gapiInited = false;
      let gisInited = false;

      document.getElementById('authorize_button').style.visibility = 'hidden';
      document.getElementById('signout_button').style.visibility = 'hidden';

      /**
       * Callback after api.js is loaded.
       */
      function gapiLoaded() {
        gapi.load('client', initializeGapiClient);
      }

      /**
       * Callback after the API client is loaded. Loads the
       * discovery doc to initialize the API.
       */
      async function initializeGapiClient() {
        await gapi.client.init({
          apiKey: API_KEY,
          discoveryDocs: [DISCOVERY_DOC],
        });
        gapiInited = true;
        maybeEnableButtons();
      }

      /**
       * Callback after Google Identity Services are loaded.
       */
      function gisLoaded() {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: '', // defined later
        });
        gisInited = true;
        maybeEnableButtons();
      }

      /**
       * Enables user interaction after all libraries are loaded.
       */
      function maybeEnableButtons() {
        if (gapiInited && gisInited) {
          document.getElementById('authorize_button').style.visibility = 'visible';
        }
      }

      /**
       *  Sign in the user upon button click.
       */
      function handleAuthClick() {
        tokenClient.callback = async (resp) => {
          if (resp.error !== undefined) {
            throw (resp);
          }
          document.getElementById('signout_button').style.visibility = 'visible';
          document.getElementById('authorize_button').innerText = 'Refresh';
          await listLabels();
        };

        if (gapi.client.getToken() === null) {
          // Prompt the user to select a Google Account and ask for consent to share their data
          // when establishing a new session.
          tokenClient.requestAccessToken({prompt: 'consent'});
        } else {
          // Skip display of account chooser and consent dialog for an existing session.
          tokenClient.requestAccessToken({prompt: ''});
        }
      }

      /**
       *  Sign out the user upon button click.
       */
      function handleSignoutClick() {
        const token = gapi.client.getToken();
        if (token !== null) {
          google.accounts.oauth2.revoke(token.access_token);
          gapi.client.setToken('');
          document.getElementById('content').innerText = '';
          document.getElementById('authorize_button').innerText = 'Authorize';
          document.getElementById('signout_button').style.visibility = 'hidden';
        }
      }

      /**
       * Print all Labels in the authorized user's inbox. If no labels
       * are found an appropriate message is printed.
       */
      async function listLabels() {
        let response;
        try {
          response = await gapi.client.gmail.users.labels.list({
            'userId': 'me',
          });
        } catch (err) {
          document.getElementById('content').innerText = err.message;
          return;
        }
        const labels = response.result.labels;
        if (!labels || labels.length == 0) {
          document.getElementById('content').innerText = 'No labels found.';
          return;
        }
        // Flatten to string to display
        const output = labels.reduce(
            (str, label) => `${str}${label.name}\n`,
            'Labels:\n');
        document.getElementById('content').innerText = output;
      }
    </script>
    <script async defer src="https://apis.google.com/js/api.js" onload="gapiLoaded()"></script>
    <script async defer src="https://accounts.google.com/gsi/client" onload="gisLoaded()"></script>
  </body>
</html>
```