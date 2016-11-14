# SQSD

A simple alternative to the Amazon SQS Daemon ("sqsd") used on AWS Beanstalk worker tier instances. Inspired by https://github.com/mozart-analytics/sqsd, rewriten for Node.js.

## Architecture Diagram

[AWS Beanstalk](http://aws.amazon.com/elasticbeanstalk/) provides a simple to use *Worker Environment Tier*
([more info](http://docs.aws.amazon.com/elasticbeanstalk/latest/dg/using-features-managing-env-tiers.html)) that greatly streamlines the deployment of passive worker microservices for background or async processing.

![aws-eb-worker](http://docs.aws.amazon.com/elasticbeanstalk/latest/dg/images/aeb-messageflow-worker.png)

*(diagram by AWS - available [here](http://aws.amazon.com/elasticbeanstalk/))*

## Description

As the included diagram portrays, in a common workflow, the worker instance will consume messages sent to a specified [Amazon SQS](http://aws.amazon.com/documentation/sqs/) from another service (e.g.: a web server or another worker). These messages will be received by the worker via POST requests. This eliminates the necessity of configuring a worker as an always-on service, as well as having to add code for reading and consuming messages from an AWS SQS queue. In other words, the worker is implemented as a standard RESTful API/Service that will react to a message sent to it at an specific endpoint via a POST request. This is an awesome approach by Amazon to microservices and [reactive design](www.reactivemanifesto.org/).

The conversion of the SQS message to a POST request is executed by what AWS calls the *"SQS Daemon"* or *"Sqsd"*. This is a simple daemon they pre-install in the worker tier instances that is constantly monitoring an specific AWS SQS queue (provided by configuration) for new messages. When new messages arrive, it constructs a `POST` request and sends it to a specific endpoint (also provided via configuration). If the endpoint consumes it without errors and returns a `2**` HTTP Code in its response, the *"Sqsd"* deletes the message from the queue to signal that its consumption was successful.

However, even though this approach is extremely powerful, Amazon does not provide the code of this daemon as open source. Therefore, we have reproduced its behavior by creating our own version of the *"Sqsd"* free for everyone to use. Moreover, we have provided lots of customization and configuration properties so that it can be molded to your specific use cases.

But even more important! **We have "dockerized" it** so that you can use it as a Docker container along your worker (even link it to it). This makes this microserviced worker approach even more powerful as it can be easily pre-configured and pre-packaged to be deployed automatically along your services using your favorite Docker orchestration frameworks or even the recently announced [Amazon EC2 Container Service](http://aws.amazon.com/ecs/).

Following are detailed instructions of configuration and usage with and without Docker. Any changes, suggestions or Forks are welcome!

## Technologies / Environments Used
- Node.js 4+
- AWS Node SDK 2.2.26+

## Usage

### Running / Executing

#### Local development
To execute the program, clone down the repository, navigate to it with a terminal and run `npm start`

#### As global command-line tool

To run as global command-line tool, you can either install globally from NPM or clone down the repository and run `npm link`
to link it to your global `node_modules` directory.


```bash
# Global Install
:~: $ npm install sqsd -g
:~: $ sqsd --help
```

```bash
# Link from terminal
:~: $ cd /Workspace/sqsd
:~/Workspace/sqsd: $ npm link
:~/Workspace/sqsd: $ sqsd --help
```

### Configuration
There are 2 ways to configure the `sqsd`'s properties: Environment Variables or command-line arguments. You must set one of the two options.

#### Using Environment Variables
Environment Variables are loaded from an `.env` file using the [dotenv](https://www.npmjs.com/package/dotenv) module.

When the program is run, it will automatically look for an `.env` file in the directory the program is executed from.

If you want to specify your own file, use the `--env` command-line argument

```bash
:~: $ sqsd --env path/to/env/file
```

#### Using Command-Line arguments
You can also specify properties using command-line flags. See the _Options_ table below for the full list of command-line arguments.

Run the program with the `--help` flag to see the full list of accepted arguments.

```bash
:~: $ sqsd --help
```

#### Options

| **Command-Line Argument**  |             **Environmet Variable**              |    **Default**     | **Required** |                                                   **Description**                                                    |
|---|--------------------------------------------------|--------------------|--------------|----------------------------------------------------------------------------------------------------------------------|
|  --access-key-id | `AWS_ACCESS_KEY_ID`                              | -                  | no           | Your AWS Access Key.                                                                                                 |
| --secret-access-key  | `AWS_SECRET_ACCESS_KEY`                          | -                  | no           | Your AWS secret access secret.                                                                                       |
|  -r, --region | `SQSD_QUEUE_REGION_NAME` or `AWS_DEFAULT_REGION` | `us-east-1`        | no           | The region name of the AWS SQS queue                                                                                 |
| -q, --queue-url  | `SQSD_QUEUE_URL`                                 | -                  | no          | Your queue URL.                                                                                                      |
| --queue-name  | `SQSD_QUEUE_NAME`                                 | -                  | no          | The name of the queue. Fetch from queue URL if blank                                                                                                      |
| --endpoint-url  | `SQSD_ENDPOINT_URL`                                 | -                  | no          | Your endpoint URL if you using a fake sqs.                                                                                                      |
| --ssl-enabled  | `SQSD_SSL_ENABLED`                                 | `true`                  | no          | To enable ssl or not.                                                                                                      |
|  -m, --max-messages | `SQSD_MAX_MESSAGES_PER_REQUEST`                  | `10` (max: `10`)   | no           | Max number of messages to retrieve per request.                                                                      |
|  -d, --daemonized | `SQSD_RUN_DAEMONIZED`                            | `0`                | no           | Whether to continue running with empty queue (0,no,false is no, 1,yes,true is yes)                                   |
|  -s, --sleep | `SQSD_SLEEP_SECONDS`                             | `0`                | no           | Number of seconds to wait after polling empty queue when daemonized                                                  |
|  --wait-time | `SQSD_WAIT_TIME_SECONDS`                         | `20` (max: `20`)   | no           | Long polling wait time when querying the queue.                                                                      |
| -w, --web-hook | `SQSD_WORKER_HTTP_URL`                           | -                  | yes          | Web url address to your service.                                                                                     |
| --content-type | `SQSD_WORKER_HTTP_REQUEST_CONTENT_TYPE`          | `application/json` | no           | Message MIME Type.                                                                                                   |
| --concurrency  | `SQSD_WORKER_CONCURRENCY`                        | 3                  | no           | Number of concurrent http request to worker service                                                                  |
|  -t, --timeout | `SQSD_WORKER_TIMEOUT`                            | 60000              | no           | Timeout for waiting response from worker, ms                                                                         |
|  --worker-health-url | `SQSD_WORKER_HEALTH_URL`                         | -                  | no           | Url for checking that worker is running, useful when running in linked containers and worker needs some time to  up. |
|  --worker-health-wait-time | `SQSD_WORKER_HEALTH_WAIT_TIME`                   | 10000              | no           | Timeout for waiting while worker become  health, ms                                                                  |


#### Using Docker (with service/worker hosted outside this container)
Use this run configuration when your worker is running in another container or in a remote server.

    cd /your/sqsd/local/path
    docker build -t someImageName .
    docker run -e -e SQSD_WORKER_HTTP_URL=http://someRemoteHost/someRemotePath someImageName

**Remember that if you are running your worker on your Docker host's instance, you cannot use `localhost` as the worker host path since the `localhost` in this case will be the container's address, not your host's. Use linked containers instead**

#### Running with fake_sqs

You may want to run fake_sqs for local development. To do this gem install fake_sqs and run it with command:
`fake_sqs`

You will then need to configure sqsd to communicate with the fake sqs server.
Here is a sample .env file below.

SQSD_QUEUE_NAME=queue_name
SQSD_WORKER_HTTP_URL=http://127.0.0.1
SQSD_ENDPOINT_URL=http://127.0.0.1:4568
SQSD_SSL_ENABLED=false
AWS_ACCESS_KEY_ID=meh
AWS_SECRET_ACCESS_KEY=meh

The access key and the secret key must not be blank.
