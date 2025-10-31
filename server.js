const express = require('express');
const fetch = require('node-fetch').default;
const cors = require('cors');
const { URL } = require('url');
const { relative } = require('path');
const app = express();
app.use(express.json());
app.use(cors());

const PAT = process.env.AZURE_PAT;

console.log(PAT);

const customEncoder = (str) => {
  // replace instances of & with %26
  return str.replace(/&/g, '%26');
};

const getActivityIDsFromNavigation = async (navigationContent, url) => {
  const fileNames = navigationContent['templates'];

  const activityIDs = {};

  for (const fileName of fileNames) {
    let templateURL = url.replace(/navigation\.json.*/,'') + encodeURIComponent(fileName) + '.json&includeContent=true&api-version=7.1-preview.1';
    // get last 3 letters:
    const format = fileName.slice(-3).toUpperCase();

    try {
            // fetch the contents at the URL:
            const response = await fetch(templateURL, {
                headers: {
                    Authorization: `Basic ${Buffer.from(":" + PAT).toString('base64')}`, Accept: 'application/json'
                }
            });

            if (!response.ok) {
                continue;
            }

            const data = await response.json();
            const unit = JSON.parse(data.content);


            for(const unitActivity of unit.unitActivities) {
              activityIDs[unitActivity.activityName+format] = unitActivity.activityId;
            }

            for(const module of unit.modules) {
              for(const moduleActivity of module.moduleActivities) {
                activityIDs[moduleActivity.activityName+format] = moduleActivity.activityId;
              }
              for (const topic of module.topics) {
                for (const topicActivity of topic.topicActivities) {
                  activityIDs[topicActivity.activityName+format] = topicActivity.activityId;
                }
              } 
            }

        } catch (error) {
            console.error(error);
            continue;
        }
      }

      return activityIDs;

}

app.post ('/fetch-activity-ids', async (req, res) => {

  const unitName = req.body.unitName;

  const potentialRepoNames = [`TTSP - ${unitName}`, `TTSP-${unitName}`, `TTSP- ${unitName}`, `TTSP -${unitName}`];

    for (let repoName of potentialRepoNames) {
      let encodedRepoName = encodeURIComponent(repoName);
      let url = `https://dev.azure.com/Revature-Technology/Technology-Engineering/_apis/git/repositories/${encodedRepoName}/items` +
      `?path=navigation.json&includeContent=true&api-version=7.1-preview.1`;
      
      
        try {
            // fetch the contents at the URL:
            const response = await fetch(url, {
                headers: {
                    Authorization: `Basic ${Buffer.from(":" + PAT).toString('base64')}`,
                    Accept: 'application/json'
                }
            });

            if (!response.ok) {
                continue;
            }

            const data = await response.json();
            const activityIDs =await getActivityIDsFromNavigation(JSON.parse(data.content), url);
            return res.send(activityIDs);
        } catch (error) {
            console.error(error);
            continue;
        }
    }

    res.status(404).send('Navigation file not found');
});

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
    // encode filepath to handle special characters
    const encodedFilePath = encodeURIComponent(filePath);

    if (!filePath) {
      return res.status(400).send('File path not found in URL');
    }

    const markdownURL = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/items` +
      `?path=${encodedFilePath}&includeContent=true&api-version=7.1-preview.1`;
    

    const response = await fetch(markdownURL, {
      headers: {
        Authorization: `Basic ${Buffer.from(":" + PAT).toString('base64')}`,
        Accept: 'application/json'
      }
    });


    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch file content');
    }

    const content = await response.text();

    const resourceMetaData = await parse_markdown(content, url);
    let imgs = [];
    let imgNames = new Set();


    for (let img of resourceMetaData.imgs) {
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
        if (!imgNames.has(img.name)) {
          imgs.push({ imgData, name: img.name, oldName: img.oldName });
        }
        imgNames.add(img.name);
        
    }

    // fetch gifts similarly if needed
    let gifts = [];
    let giftNames = new Set();


    for (let gift of resourceMetaData.gifts) {
        const giftResponse = await fetch(gift.url, {
          headers: {
            Authorization: `Basic ${Buffer.from(":" + PAT).toString('base64')}`,
            Accept: 'application/octet-stream'
          }
        });
        if (!giftResponse.ok) {
          return res.status(giftResponse.status).send('Failed to fetch gift content');
        }
        const giftBuffer = await giftResponse.arrayBuffer();
        const giftData = Buffer.from(giftBuffer).toString('base64');
        if (!giftNames.has(gift.name)) {
          gifts.push({ giftData, name: gift.name, oldName: gift.oldName });
        }
        giftNames.add(gift.name);
    }

    res.send({ content, imgs, gifts });

  }

  catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }


});

const parse_markdown = async (content, markdownURL) => {
  const imgRegex =  /!\[.*?\]\((.*?)\)/g;
  const giftRegex = /\[[^\]]+\]\([^)]*?([^/()]+\.gift)\)/g;


  return {imgs: await resource_util(content, markdownURL, imgRegex), gifts: await resource_util(content, markdownURL, giftRegex)};
}

const resource_util = async (content, markdownURL, regex) => {
  // Extract the repo base (before ?path=) and the query params
  const url = new URL(markdownURL);  
  
  const [, organization, project, , repo] = url.pathname.split('/');

  // Extract the `path` and `version`
  const pathParam = url.searchParams.get('path');
  let version;
  try {
    version = url.searchParams.get('version').replace(/^GB/, ''); // remove GB prefix (branch)
    } catch (e) {
      version = null;
    }
  const markdownDir = pathParam.substring(0, pathParam.lastIndexOf('/'));

  // Search for all instances of the regex in the content
  
  const resources = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const relativePath = match[1];

    // ignore absolute URLs
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
      continue;
    }

    // Resolve relative path to absolute
    const resolvedPath = new URL(relativePath, `https://example.com${markdownDir}/`).pathname;
    // encode resolvedPath to handle special characters
    const encodedResolvedPath = customEncoder(resolvedPath);

    // Construct direct content URL
    const rawUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repo}/items?path=${encodedResolvedPath}` + (version ? `&versionType=branch&version=${version}` : '');

    const resourceName = relativePath.split('/').pop();
    // encode resourceName to handle special characters
    const encodedResourceName = customEncoder(resourceName);
    resources.push({url: rawUrl, oldName: relativePath, name: encodedResourceName});
  }
  return resources;
}

app.listen(3001, () => console.log("Server running on port 3001"));
