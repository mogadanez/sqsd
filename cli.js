#!/usr/bin/env node
'use strict';

var logger = require('./lib/logger');
var sqsd = require('./lib/index').SQSProcessor;
var program = require('commander');
var _ = require('lodash');



function list(val) {
    return val.split(',');
}

var pkg = require('./package.json');

program.version(pkg.version)
    .option('-w, --web-hook [value]', 'The webhook url to which messages from queue be posted.' )
    .option('--access-key-id [value]', 'Your AWS Access Key. Leave empty if use IAM roles.')
    .option('--secret-access-key [value]', 'Your AWS Secret Access Key. Leave empty if use IAM roles.')
    .option('-r, --region [value]', 'The region name of the AWS SQS queue', "us-east-1")
    .option('--queue-url [value]', 'Your queue URL. You can instead use the queue name but this takes precedence over queue name.')
    .option('--queue-name [value]', 'Your queue name.')
    .option('-m, --max-messages [value]', 'Max number of messages to retrieve per request.', 10)
    .option('-d, --daemonized', 'Whether to continue running with empty queue', false )
    .option('-s, --sleep [value]', 'Number of seconds to wait after polling empty queue when daemonized', 0 )
    .option('-t, --timeout [value]', 'Timeout for waiting response from worker, ms', 60000 )
    .option('--wait-time [value]', 'Long polling wait time when querying the queue.', 20 )
    .option('--content-type [value]', 'Long polling wait time when querying the queue.', 'application/json' )
    .option('--concurrency [value]', 'Long polling wait time when querying the queue.',  3  )
    .option('--user-agent [value]', 'User agent',  "sqsd"  )

process.argv[1] = 'sqsd';
program.parse(process.argv);

var envParams = { accessKeyId: process.env.AWS_ACCESS_KEY_ID
    , secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    , region: process.env.SQS_QUEUE_REGION_NAME
    , queueUrl: process.env.SQSD_QUEUE_URL
    , queueName: process.env.SQSD_QUEUE_NAME
    , maxMessages: process.env.SQSD_MAX_MESSAGES_PER_REQUEST
    , daemonized: process.env.SQSD_RUN_DAEMONIZED
    , sleep: process.env.SQSD_SLEEP_SECONDS
    , waitTime: process.env.SQSD_WAIT_TIME_SECONDS
    , webHook: process.env.SQSD_WORKER_HTTP_URL
    , userAgent: process.env.SQSD_WORKER_USER_AGENT
    , contentType: process.env.SQSD_WORKER_HTTP_REQUEST_CONTENT_TYPE
    , concurrency: process.env.SQSD_WORKER_CONCURRENCY
    , timeout: process.env.SQSD_WORKER_TIMEOUT
}



logger.info('SQSD v' + pkg.version);

var mergedParams = _.defaults( _.pick ( program, _.keys(envParams) ), envParams );

if ( ( !mergedParams.queueName && !mergedParams.queueUrl) || !mergedParams.webHook ) {
    program.outputHelp();
    process.exit(1);
}
new sqsd(mergedParams).start()
    .catch( err=> {
        logger.error( {err:err}, "Unexpected error")
        process.exit(1);
    })
