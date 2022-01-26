const AWS = require("aws-sdk");
const debug = require('debug')("sqsd");
const error = require('debug')('sqsd:error');
const _ = require('lodash');
const axios = require("axios")
const logger = require("./logger")
const { v4: uuid } = require('uuid');

const delay = time => new Promise(res=>setTimeout(res,time));

function Defer() {
    let resolve, reject;
    const promise = new Promise(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
}

class SQSProcessor {

    constructor(options) {
        this.options = options;
        this.errorsCount = 0;
        const params = {};
        if (options.queueUrl) {
            params.QueueUrl = options.queueUrl;
            options.queueName = options.queueUrl.substr(options.queueUrl.lastIndexOf("/") + 1)
        }

        else if (options.queueName)
            params.QueueName = options.queueName;

        const config = {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
            sessionToken: options.sessionToken,
            region: options.region,
            sslEnabled: options.sslEnabled === 'true'
        };

        if (options.endpointUrl) {
            config.endpoint = options.endpointUrl
            options.queueUrl  = options.endpointUrl + '/' + options.queueName;
            params.QueueName = options.queueName;
        }

        this._queue = new AWS.SQS(config);
        this.processingMesages = [];
        this.shutdown = false;

    }

    async postToWorker (messageBody, sqsMessage, appRequestId) {
        const headers = {
            'User-Agent': this.options.userAgent,
            'content-type': this.options.contentType,
            'X-Aws-Sqsd-Msgid': sqsMessage.MessageId,
            'X-Aws-Sqsd-Queue': this.options.queueName,
            'X-App-Request-Id':appRequestId
        };


        if (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateFirstReceiveTimestamp)
            headers['X-Aws-Sqsd-First-Received-At'] = sqsMessage.Attributes.ApproximateFirstReceiveTimestamp;

        if (sqsMessage.Attributes && sqsMessage.Attributes.ApproximateReceiveCount)
            headers['X-Aws-Sqsd-Receive-Count'] = sqsMessage.Attributes.ApproximateReceiveCount;

        if (sqsMessage.Attributes && sqsMessage.Attributes.SenderId)
            headers['X-Aws-Sqsd-Sender-Id'] = sqsMessage.Attributes.SenderId;

        for(let name in sqsMessage.MessageAttributes) {
            const value = sqsMessage.MessageAttributes[name];
            headers['X-Aws-Sqsd-Attr-'+name] = value.StringValue;
        }

        logger.info( { subsystem:"sqsd"
            , headers
            , queueUrl: this.options.queueUrl
            , webHook: this.options.webHook
            , appRequestId }, "WebHook POST")
       // debug( "WebHook POST %s, %O",  this.options.webHook, headers)

        return axios.post( this.options.webHook,
            Buffer.from(messageBody),
            {
                headers: headers,
                timeout: Number(this.options.timeout) || 0
            }
        )

    }

    handleMessage (sqsMessage) {
        if ( this.processingMesages.find(x=>  x.MessageId === sqsMessage.MessageId ) ) {
            logger.warn( { subsystem:"sqsd"
                , messageId: sqsMessage.MessageId
                , queueUrl: this.options.queueUrl
                , webHook: this.options.webHook
                , processingMessagesCount: this.processingMesages.length }, "Message already in run. probably need fix visibility timeout")
            debug( "Message already in run. probably need fix visibility timeout", {messageId: sqsMessage.MessageId } )
            return;
        }
        debug( "add message to queue", {currentLength: this.processingMesages.length} )
        this.processingMesages.push( sqsMessage )
        const messageBody = sqsMessage.Body;
        const receipt_handle = sqsMessage.ReceiptHandle;

        const startTime = new Date().getTime();
        let appRequestId = uuid();
        sqsMessage.promise =  this.postToWorker(messageBody, sqsMessage, appRequestId)

        .then( async (postResult) => {
            logger.info( { subsystem:"sqsd"
                , messageId: sqsMessage.MessageId
                , queueUrl: this.options.queueUrl
                , webHook: this.options.webHook
                , processingMessagesCount: this.processingMesages.length
                , workerStatus: postResult.status
                , appRequestId }, "Received result from worker")
            debug(  "Received result from worker, MessageId: %s  statusCode:%s ", sqsMessage.MessageId, postResult.status)
            if (!(postResult.status < 200 || postResult.status >= 300)) {
                await this._queue.deleteMessage({
                    ReceiptHandle: receipt_handle,
                    QueueUrl: this.options.queueUrl
                }).promise()
                logger.info( { subsystem:"sqsd"
                    , messageId: sqsMessage.MessageId
                    , queueUrl: this.options.queueUrl
                    , webHook: this.options.webHook
                    , processingMessagesCount: this.processingMesages.length
                    , workerStatus: postResult.status
                    , taskTime: new Date().getTime() - startTime
                    , appRequestId }, "Message successful removed from sqs")
                debug("Message successful removed from sqs, %o ", {MessageId: sqsMessage.MessageId, taskTime: new Date().getTime() - startTime})
            } else {
                error("Worker respond  with status != 2XX, MessageId: %s  statusCode:%s ", sqsMessage.MessageId, postResult.status)
                logger.error( { subsystem:"sqsd"
                    , messageId: sqsMessage.MessageId
                    , queueUrl: this.options.queueUrl
                    , webHook: this.options.webHook
                    , processingMessagesCount: this.processingMesages.length
                    , workerStatus: postResult.status
                    , appRequestId }, "Worker respond  with status != 2XX")
            }
        })
        .then(x=> {
            debug( "Message successful processed,  MessageId: %s ", sqsMessage.MessageId)
        })
        .catch(err=> {
            logger.error( { subsystem:"sqsd"
                , err
                , messageId: sqsMessage.MessageId
                , queueUrl: this.options.queueUrl
                , webHook: this.options.webHook
                , errorsCount: this.errorsCount
                , rawBody: JSON.stringify(messageBody)
                , processingMessagesCount: this.processingMesages.length
                , taskTime: new Date().getTime() - startTime
                , appRequestId }, "Error while Message process")
            error("Error while  Message process: " + err.message)
            this.errorsCount++;
            if ( this.options.maxErrors &&  this.errorsCount> this.options.maxErrors ){
                logger.error( { subsystem:"sqsd"
                    , err
                    , messageId: sqsMessage.MessageId
                    , queueUrl: this.options.queueUrl
                    , webHook: this.options.webHook
                    , errorsCount: this.errorsCount
                    , rawBody: JSON.stringify(messageBody)
                    , processingMessagesCount: this.processingMesages.length
                    , taskTime: new Date().getTime() - startTime
                    , appRequestId }, "Too many errors, force shutdown")
                this.shutdown = true
            }


        })
        .finally(()=>{
            debug( "trying to remove message from queue")
            const index = this.processingMesages.indexOf(sqsMessage);
            debug( "message index ", {index, queueSize: this.processingMesages.length})
            if (index > -1) {
                this.processingMesages.splice(index, 1);
            }
            debug( "after message removing ", {index, queueSize: this.processingMesages.length})
            this.scheduleRun();
        })
        return sqsMessage.promise;
    }


    async doCheckWorkerHealth (beginTimeStamp) {

        debug("try ping worker by " + this.options.workerHealthUrl)

        try {
            await axios.get(this.options.workerHealthUrl)
            debug("Worker is health.")
            return true
        }
        catch(e){
            error("Check worker failed" + e.message)
            if ((beginTimeStamp + this.options.workerHealthWaitTime) < new Date().getTime())
                return false;
            await delay(1000)
            return this.doCheckWorkerHealth(beginTimeStamp)

        }
    }

    async checkWorkerHealth () {
        if (this.healthChecked) //cached result, no sense to check worker on each cycle
            return this.healthChecked;
        if (!this.options.workerHealthUrl)
            return true
        debug("Check worker for health")
        this.healthChecked = await this.doCheckWorkerHealth(new Date().getTime())
        return this.healthChecked
    }


    async tick  () {
        if (  this.polling || this.processingMesages.length >=  this.options.maxMessages ) {
            return
        }

        debug("Messages in run", (this.processingMesages.length))
        debug("Start Polling For %s Messages", (this.options.maxMessages - this.processingMesages.length))
        this.polling = true;
        let data = await this._queue.receiveMessage({
            MaxNumberOfMessages: this.options.maxMessages - this.processingMesages.length,
            WaitTimeSeconds: this.options.waitTime,
            AttributeNames: ["All"],
            MessageAttributeNames: ["All"],
            QueueUrl: this.options.queueUrl
        }).promise();

        if ( data && Array.isArray(data.Messages) && data.Messages.length >0 ) {
            debug( "Messages Received: %s ", data.Messages.length )
            data.Messages.forEach( m => {
                this.handleMessage(m);
            })
        }
        else
            debug("No Messages Received via poll time")

        this.polling = false;
        return this.scheduleRun();
    }



    scheduleRun  () {
        if (this.options.daemonized) {
            if (this.shutdown) {
                this.waitForFinish()
                .then(()=>{
                    logger.info( { subsystem:"sqsd"
                        , action: "stop"
                        , queueUrl: this.options.queueUrl
                        , webHook: this.options.webHook
                         }, "stop")
                    this.deferredStop.resolve();
                })
            }
            else {
                this.tick()
                .catch((err)=> {
                    logger.error( { subsystem:"sqsd"
                        , action: "crash"
                        , err
                        , queueUrl: this.options.queueUrl
                        , webHook: this.options.webHook
                    }, "crash")
                    this.waitForFinish()
                    .then(()=>{
                        this.deferredStop.reject(err);
                    })
                })
            }
        }
        else{
            debug("not a daemon, wait and exit")
            return this.waitForFinish()
        }
    }

    waitForFinish  () {
        debug("Wait for rest messages")
        return Promise.all(  this.processingMesages.map( x => x.promise ) )
    }


    async start () {
        await logger.init();
        let health = await  this.checkWorkerHealth()
        if (!health) {
            debug("Worker not responding, cannot continue")
            return;
        }
        if (this.options.sleep) {
            this._tick = this.tick;
            this.tick = _.throttle(this._tick.bind(this), this.options.sleep)
        }
        logger.info( { subsystem:"sqsd"
            , action: "start"
            , queueUrl: this.options.queueUrl
            , webHook: this.options.webHook
        }, "start")
        if (this.options.daemonized) {
            this.deferredStop = new Defer();//used to to stop if error happens, should works infinite in OK scenario
            await this.scheduleRun();
            return this.deferredStop.promise;
        }
        else
            return this.tick()

    }


}


exports.SQSProcessor = SQSProcessor;
