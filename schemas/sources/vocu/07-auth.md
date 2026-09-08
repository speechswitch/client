# Authentication Method


Learn how to use your API Key for authentication and to use our services

## Get Your API Key <a href="#create" id="create"></a>

You need to use an API Key to verify your identity when using Vocu's developer interfaces. You can access the **API Platform** from the side menu bar, and click the **Create API Key** button. In the pop-up window, give any name to this API Key (to facilitate recording its purpose). After confirmation, you will get a new API Key.

:::info
Each account can have a maximum of 5 different API Keys simultaneously. Once the limit is reached, you can create a new one by deleting any existing API Key. Deleted API Keys will become completely invalid and can no longer be used to access any Vocu API services.
:::

:::warning
For security reasons, each API Key will only be displayed in plaintext in the pop-up window upon initial creation. Please keep it safe; you will not be able to retrieve it after closing the pop-up window.
:::

## Access Authentication

After obtaining the API Key, you can easily complete authentication by including the following entry in the Header of any API request.

```
Authorization: Bearer <Your API Key>
```

For example:

```
Authorization: Bearer sk-2cdeh2375692vq5hp9fp32f58p967tca
```

