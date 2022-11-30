# Install

Install with **Npm**:

```bash
npm install bull --save
```

or Yarn:

```bash
yarn add bull
```

In order to work with Bull, you also need to have a Redis server running. For local development you can easily install it using [docker](https://hub.docker.com/\_/redis/).

Bull will by default try to connect to a Redis server running on `localhost:6379`

{% hint style="info" %}
&#x20;_Bull requires a Redis version greater than or equal to `2.8.18`._
{% endhint %}

### Typescript Definitions

```bash
npm install @types/bull --save-dev
```

```bash
yarn add --dev @types/bull
```

Definitions are currently maintained in the [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/bull) repo.
