const express = require('express');
const fetch = require('node-fetch').default;
const cors = require('cors');
const { URL } = require('url');
const app = express();
app.use(express.json());
app.use(cors());

const PAT = process.env.AZURE_PAT;

app.post('/fetch-azure-file', async (req, res) => {

  try {


    const url = req.body.url;

    // Basic validation
    if (!url.startsWith('https://dev.azure.com/')) {
      return res.status(400).send('Invalid Azure DevOps URL');
    }

    const parsed = new URL(url);

    const [org, project, _, repoSegment] = parsed.pathname.split('/').filter(Boolean);

    const repo = repoSegment.replace('_git/', '');
    const filePath = parsed.searchParams.get('path');

    if (!filePath) {
      return res.status(400).send('File path not found in URL');
    }

    const apiUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/items` +
      `?path=${filePath}&includeContent=true&api-version=7.1-preview.1`;

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(":" + PAT).toString('base64')}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch file content');
    }

    const content = await response.text();

    res.send({ content });

  }

  catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }


});

app.listen(3001, () => console.log("Server running on port 3001"));
