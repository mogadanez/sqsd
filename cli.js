#!/usr/bin/env node
'use strict';
const path = require('path');
const program = require('commander');
const _ = require('lodash');




function increaseVerbosity(v, total) {
    return total + 1;
}
var pkg = require('./package.json');

program.version(pkg.version)
    .option('-w, --web-hook [value]', 'The webhook url to which messages from queue be posted. Required' )
    .option('-q, --queue-url [value]', 'Your queue URL.')
    .option('--queue-name [value]', 'The name of the queue. Fetched from queue URL if empty')
    .option('--access-key-id [value]', 'Your AWS Access Key. Leave empty if use IAM roles.')
    .option('--secret-access-key [value]', 'Your AWS Secret Access Key. Leave empty if use IAM roles.')
    .option('--endpoint-url [value]', 'Your endpoint Url if your using a fake service. Leave empty if using Amazon sqs.')
    .option('-r, --region [value]', 'The region name of the AWS SQS queue')
    .option('-m, --max-messages [value]', 'Max number of messages to retrieve per request.',parseInt )
    .option('-d, --daemonized ', 'Whether to continue running with empty queue'  )
    .option('-s, --sleep [value]', 'Number of seconds to wait after polling empty queue when daemonized', parseInt)
    .option('-t, --timeout [value]', 'Timeout for waiting response from worker, ms' )
    .option('--worker-health-url [value]', 'Url for checking that worker is running, useful when running in linked containers and worker needs some time to  up' )
    .option('--worker-health-wait-time [value]', 'Timeout for waiting while worker become  health, ms' )
    .option('--wait-time [value]', 'Long polling wait time when querying the queue.', parseInt)
    .option('--content-type [value]', 'Long polling wait time when querying the queue.' )
    .option('--concurrency [value]', 'Long polling wait time when querying the queue.', parseInt,  3  )
    .option('--user-agent [value]', 'User agent',  "sqsd"  )
    .option('--env [value]', 'Path to .env file to load environment variables from. Optional', '.env')
    .option('--ssl-enabled [value]', 'To enable ssl or not. Default is true')
    .option('-v, --verbose', 'A value that can be increased', increaseVerbosity, 0)


process.argv[1] = 'sqsd';
program.parse(process.argv);

var defaults = {
     region: "us-east-1"
    , maxMessages: 10
    , daemonized: false
    , sleep: 0
    , waitTime: 20
    , userAgent: "sqsd"
    , contentType: 'application/json'
    , concurrency: 3
    , timeout: 60000
    , workerHealthWaitTime: 10000
    , sslEnabled: true
    , verbose: 0
}

const dotenv = require('dotenv');
dotenv.config({
    silent: true,
    path: path.resolve(__dirname, program.env)
});

var envParams = { accessKeyId: process.env.AWS_ACCESS_KEY_ID
    , secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    , sessionToken: process.env.AWS_SESSION_TOKEN
    , region: process.env.SQSD_QUEUE_REGION_NAME || process.env.AWS_DEFAULT_REGION
    , queueUrl: process.env.SQSD_QUEUE_URL
    , maxMessages: process.env.SQSD_MAX_MESSAGES_PER_REQUEST
    , daemonized:  (process.env.SQSD_RUN_DAEMONIZED || "") in { "1":1, "yes":1, "true":1 }
    , sleep: process.env.SQSD_SLEEP_SECONDS
    , waitTime: process.env.SQSD_WAIT_TIME_SECONDS
    , webHook: process.env.SQSD_WORKER_HTTP_URL
    , userAgent: process.env.SQSD_WORKER_USER_AGENT
    , contentType: process.env.SQSD_WORKER_HTTP_REQUEST_CONTENT_TYPE
    , concurrency: process.env.SQSD_WORKER_CONCURRENCY
    , timeout: process.env.SQSD_WORKER_TIMEOUT
    , workerHealthUrl: process.env.SQSD_WORKER_HEALTH_URL
    , workerHealthWaitTime: process.env.SQSD_WORKER_HEALTH_WAIT_TIME
    , endpointUrl: process.env.SQSD_ENDPOINT_URL
    , queueName: process.env.SQSD_QUEUE_NAME
    , sslEnabled: process.env.SQSD_SSL_ENABLED
}

var extractedCliArgs = _.pick(program, Object.keys(envParams));
var mergedParams = _.defaults(extractedCliArgs, envParams, defaults);

if (!mergedParams.webHook) {
    console.log ( "--web-hook is required")
    //program.outputHelp();
    process.exit(1);
}


const debug = require('debug')("sqsd");
const error = require('debug')('sqsd:error');
const sqsd = require('./lib/index').SQSProcessor;

console.log('SQSD v' + pkg.version);
new sqsd(mergedParams).start()
    .then(()=>{
        process.exit(0);
    })
    .catch( err=> {
        console.error( err )
        process.exit(1);
    })
