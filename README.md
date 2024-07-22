![Screenshot 2024-07-05 183051](https://github.com/mlix8hoblc/github-stream/assets/110055457/7c6022fc-eb1b-4a09-900b-2d85b1d7ddba)

# Prerequistes

You need a [GitHub](https://github.com/settings/tokens) _(public_repo)_ and a [LocationIQ](https://my.locationiq.com/dashboard/#accesstoken) API key.  
Optionally, you can use an [OpenAI](https://platform.openai.com/api-keys) API key instead of [Ollama](https://github.com/ollama/ollama).

# Usage

```
$ git clone && cd ./github-stream
$ cd ./globe && git checkout main && git pull && cd -
$ npm install
$ cp .env.example .env
$ curl -fsSL https://ollama.com/install.sh | sh
$ ollama serve &
$ ollama pull llama3
$ node index.js
```

Run the GitHub Actions workflow locally using [act-cli](https://github.com/nektos/act):

```
$ curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
$ act -P ubuntu-latest=catthehacker/ubuntu:act-latest -b
```

Visualize data on the globe:

```
$ cd ./globe
$ npm install
$ npm run dev
```

Visit http://localhost:8080.