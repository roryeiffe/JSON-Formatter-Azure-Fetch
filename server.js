const express = require('express');
const fetch = require('node-fetch').default;
const cors = require('cors');
const { URL } = require('url');
const app = express();
app.use(express.json());
app.use(cors());

const PAT = process.env.AZURE_PAT;

console.log(PAT);

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

    const markdownUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/items` +
      `?path=${filePath}&includeContent=true&api-version=7.1-preview.1`;
    

    const response = await fetch(markdownUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(":" + PAT).toString('base64')}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch file content');
    }

    const content = await response.text();

    const imgsMetaData = await img_util(content, markdownUrl);
    let imgs = [];

    for (let img of imgsMetaData) {
      // fetch image from url:
        const imgResponse = await fetch(img.url, {
          headers: {
            Authorization: `Basic ${Buffer.from(":" + PAT).toString('base64')}`,
            Accept: 'application/octet-stream'
          }
        });
        if (!imgResponse.ok) {
          return res.status(imgResponse.status).send('Failed to fetch image content');
        }
        const imgBuffer = await imgResponse.arrayBuffer();
        const imgData = Buffer.from(imgBuffer).toString('base64');
        imgs.push({imgData, name: img.name});
    }

    res.send({ content, imgs });

  }

  catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }


});

const img_util = async (content, markdownURL) => {
  // Search for all instances of image links in markdown format ![alt text](image_url)
  const imgRegex = /!\[.*?\]\((.*?)\)/g;
  const imgs = [];
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    const imagePath = match[1];
    const imageApiUrl = markdownURL.replace('Cumulative.md', imagePath) + '&api-version=7.1-preview.1&$format=octetStream';

    imgs.push({url: imageApiUrl, name: imagePath});
  }
  return imgs;
}

app.listen(3001, () => console.log("Server running on port 3001"));
