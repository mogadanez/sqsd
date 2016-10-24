var AWS = require("aws-sdk");
var Promise = require("bluebird");
var logger = require('./logger');
var http = require('request');
var _ = require('lodash');
var httpPOST = Promise.promisify(http.post);
var httpGET = Promise.promisify(http.get);

var SQSProcessor = function (options) {
    this.options = options;
    var params = {};
    if (options.queueUrl) {
        params.QueueUrl = options.queueUrl;
        options.queueName = options.queueUrl.substr(options.queueUrl.lastIndexOf("/") + 1)
    }

    else if (options.queueName)
        params.QueueName = options.queueName;

    var config = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        region: options.region,
        sslEnabled: options.sslEnabled == 'true' ? true : false
    }

    if (options.endpointUrl) {
        config.endpoint = options.endpointUrl
        options.queueUrl  = options.endpointUrl + '/' + options.queueName;
        params.QueueName = options.queueName;
    }

    this._queue = new AWS.SQS(config);
    this.receiveMessage = Promise.promisify (this._queue.receiveMessage, this._queue)
    this.deleteMessage = Promise.promisify (this._queue.deleteMessage, this._queue)
    this.processingMesages = [];

};

SQSProcessor.prototype.postToWorker = function (messageBody, sqsMessage) {
    var headers = {
        'User-Agent': this.options.userAgent,
        'content-type': this.options.contentType,
        'X-Aws-Sqsd-Msgid': sqsMessage.MessageId,
        'X-Aws-Sqsd-Queue': this.options.queueName
    }

    if (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateFirstReceiveTimestamp)
        headers['X-Aws-Sqsd-First-Received-At'] = sqsMessage.Attributes.ApproximateFirstReceiveTimestamp;

    if (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount)
        headers['X-Aws-Sqsd-Receive-Count'] = sqsMessage.Attributes.ApproximateReceiveCount;

    if (sqsMessage.Attributes && sqsMessage.Attributes.SenderId)
        headers['X-Aws-Sqsd-Sender-Id'] = sqsMessage.Attributes.SenderId;

    logger.trace( { url: this.options.webHook, headers: headers },  "WebHook POST")


    return httpPOST({
        url: this.options.webHook,
        body: new Buffer(messageBody),
        headers: headers,
        timeout: Number(this.options.timeout) || 0
    })

}


SQSProcessor.prototype.handleMessage = function (sqsMessage) {
    this.processingMesages.push( sqsMessage )
    var messageBody = sqsMessage.Body;
    var receipt_handle = sqsMessage.ReceiptHandle;

    var startTime = new Date().getTime();
    sqsMessage.promise =  this.postToWorker(messageBody, sqsMessage)
        .spread((postResult) => {
            logger.trace({
                MessageId: sqsMessage.MessageId,
                statusCode: postResult.statusCode
            }, "Received result from worker")
            if (!(postResult.statusCode < 200 || postResult.statusCode >= 300)) {
                return this.deleteMessage({
                        ReceiptHandle: receipt_handle,
                        QueueUrl: this.options.queueUrl
                    })
                    .then((res)=> {
                        logger.debug({MessageId: sqsMessage.MessageId, taskTime: new Date().getTime() - startTime}, "Message successful removed from sqs ")
                    })
            } else logger.error({
                MessageId: sqsMessage.MessageId,
                statusCode: postResult.statusCode
            }, "Worker respond  with status != 2XX  ")
        })
        .then(x=> {
            logger.info({MessageId: sqsMessage.MessageId}, "Message successful processed")
        })
        .catch(err=> {
            logger.error("Error while  Message process: " + err.message)
        })
        .finally(()=>{
            var index = this.processingMesages.indexOf(sqsMessage);
            if (index > -1) {
                this.processingMesages.splice(index, 1);
            }
            this.scheduleRun();
        })
    return sqsMessage.promise;
}


SQSProcessor.prototype.doCheckWorkerHealth = function (beginTimeStamp) {

    logger.warn("try ping worker by " + this.options.workerHealthUrl)
    return httpGET({url: this.options.workerHealthUrl})
        .then(function () {
            logger.debug("Worker is health.")
            return true;
        })
        .catch(e=> {

            logger.warn("Check worker failed" + e.message)
            if ((beginTimeStamp + this.options.workerHealthWaitTime) < new Date().getTime())
                return false;


            return Promise.resolve()
                .delay(1000)
                .then(()=> {
                    return this.doCheckWorkerHealth(beginTimeStamp)
                })

        })
}

SQSProcessor.prototype.checkWorkerHealth = function () {

    if (this.healthChecked) //cached result, no sense to check worker on each cycle
        return Promise.resolve(this.healthChecked);
    if (!this.options.workerHealthUrl)
        return Promise.resolve(true)
    logger.info("Check worker for health")

    return this.doCheckWorkerHealth(new Date().getTime())
        .then(x=> {
            this.healthChecked = x
            return x;
        })

}

SQSProcessor.prototype.tick = function () {
    if (  this.polling || this.processingMesages.length >=  this.options.maxMessages ) {
        return Promise.resolve()
    }

    logger.info("Start Polling For %s Messages", (this.options.maxMessages - this.processingMesages.length))
    this.polling = true;
    return this.receiveMessage({
            MaxNumberOfMessages: this.options.maxMessages - this.processingMesages.length,
            WaitTimeSeconds: this.options.waitTime,
            AttributeNames: ["All"],
            MessageAttributeNames: ["All"],
            QueueUrl: this.options.queueUrl
        })
        .then(data => {
            if (!data || !Array.isArray(data.Messages) || data.Messages.length == 0) {
                logger.debug("No Messages Received via poll time")
                return;
            }
            logger.info({count: data.Messages.length}, "Messages Received")

          _.each( data.Messages, m => {
              this.handleMessage(m);
          })

        })
        .then(()=>{
            this.polling = false;
            return this.scheduleRun();
        })
}

function defer() {
    var resolve, reject;
    var promise = new Promise(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
}

SQSProcessor.prototype.scheduleRun = function () {
    if (this.options.daemonized) {
        this.tick()
            .catch((e)=> {
                this.deferredStop.reject(e);
            })
    }
    else{
        return this.waitForFinish()
    }
}


SQSProcessor.prototype.waitForFinish = function () {
    logger.warn("Wait for rest messages")
    return Promise.all(  this.processingMesages.map( x => x.promise ) )
}


SQSProcessor.prototype.start = function () {
    return this.checkWorkerHealth()
        .then((health)=> {
            if (!health) {
                logger.warn("Worker not responding, cannot continue")
                return;
            }
            if (this.options.sleep) {
                this._tick = this.tick;
                this.tick = _.throttle(this._tick.bind(this), this.options.sleep)
            }
            if (this.options.daemonized) {
                this.deferredStop = new defer();//used to to stop if error happens, should works infinite in OK scenario
                this.scheduleRun();
                return this.deferredStop.promise;
            }
            else
                return this.tick()
        })
}


exports.SQSProcessor = SQSProcessor;
