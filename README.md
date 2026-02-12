## How to Run
### Install Node
Make sure you have Node.js installed. You can download it from [nodejs.org](https://nodejs.org/).

### Install Dependencies
Run the following command to install the required dependencies:
```bash
npm install
```

### Set Up Environment Variables
Create a Personal Access Token (PAT) from your Azure DevOps account. The permissions should include read permissions on code repositories.

Set this environment variable 
- key: `AZURE_PAT`
- value: `<Your Personal Access Token>`

### Start the Application
To start the application, use the following command:
```bash 
node server.js
```