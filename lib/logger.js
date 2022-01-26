const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const _ = require('lodash');
const winston = require('winston');
require('winston-daily-rotate-file');

const { v4: uuid } = require('uuid');
const { version } = require('../package.json');

let dockerId;

const {
    NODE_ENV: env,
    APP_ENV,
    LOG_PATH = path.join(__dirname, '../logs'),
    AUDIT_PATH = path.join(__dirname, '../logs'),
    LOG_MAX_FILES,
    LOG_MAX_FILE_SIZE = '1g',
    LOG_FILE_NAME,
    HOSTNAME,
} = process.env;


let transports = [];

let winstonLogger;

const init = async function init() {
    try {
        let hostname = HOSTNAME;
        try {
            if (process.env.ECS_CONTAINER_METADATA_URI) {
                let response = await axios.get(
                    process.env.ECS_CONTAINER_METADATA_URI
                );
                hostname = response.data.DockerId;
                dockerId = response.data.DockerId;
            }
        } catch (e) {
            console.log( "failed to get metadata")
            console.error(e);
        }
        if ( !hostname )
            hostname = `generated-${uuid()}`;

        const filename= path.join(
            LOG_PATH,
            `/${LOG_FILE_NAME || `${hostname || 'log'}`}-%DATE%.log`
        )
        const auditFile= path.join(
            AUDIT_PATH,
            `/${`${hostname || 'audit'}`}.json`
        );
        console.log( "init logger:", hostname,  dockerId, filename, auditFile )

        if (!process.env.OMIT_FILE_LOGS ) {
            fs.ensureDirSync(LOG_PATH);
            let file_transport = new winston.transports.DailyRotateFile({
                filename,
                auditFile,
                datePattern: 'YYYY-MM-DD',
                maxSize: LOG_MAX_FILE_SIZE,
                maxFiles: LOG_MAX_FILES,
            });
            transports.push(file_transport);
        }
        if (!process.env.OMIT_CONSOLE_LOGS)
            transports.push(
                new winston.transports.Console({
                    level: process.env.LOG_LEVEL || 'error',
                    format: winston.format.json(),
                })
            );
        winstonLogger = winston.createLogger({
            transports,
        });
    } catch (e) {
        console.log( "failed to start logger")
        console.error(e);
    }
};


var maxInnerLevel = 2;

function getFullErrorStack(ex, shallowStack, level) {
    var ret = ex.stack || ex.toString();
    if (!shallowStack) {
        level = level | 0;
        if (level < maxInnerLevel && ex.innerError) {
            ret +=
                '\nCaused by: ' +
                getFullErrorStack(ex.innerError, false, level + 1);
        }
        if (level < maxInnerLevel && ex.cause) {
            ret += '\nCause: ' + getFullErrorStack(ex.cause, false, level + 1);
        }
    }
    return ret;
}

function stringDefaults(target, source) {
    const errKeys = _.keys(source);
    _.forEach(errKeys, (key) => {
        if (typeof target[key] === 'undefined') {
            const val = source[key];
            target[key] = _.isPlainObject(val)
                ? stringDefaults({}, val)
                : String(val);
        }
    });
    return target;
}

function errorSerializer(err, shallowStack, level) {
    if (!err) return null;
    level = level | 0;
    var messages =
        err.messages && Array.isArray(err.messages)
            ? ': ' + err.messages.join(';')
            : '';
    var obj = {
        message: err.message,
        messages: messages,
        name: err.name,
        stack: messages + getFullErrorStack(err, shallowStack, level),
        //looks it too much for logging. if required, should put this to s3 bucket
        innerError:
            level < maxInnerLevel
                ? errorSerializer(err.innerError, false, level + 1)
                : undefined,
        cause:
            level < maxInnerLevel
                ? errorSerializer(err.cause, false, level + 1)
                : undefined,
    };
    stringDefaults(obj, err);
    delete config
    delete obj.constructor$;
    delete obj['error@context'];
    return _.omit( obj, "config", "request", "response", "toJSON");
}

var formatMessage = function (message) {
    let formatted;
    try {
        formatted =  _.extend(
            _.omit(
                message,
                'error',
                'err',
                'queryParams',
                'message'
            ),
            {
                '@timestamp': new Date().toISOString(),
                msg: message.message,
                error: errorSerializer(message.error || message.err),
            }
        );
    } catch (e) {
        console.error(e)
    }

    return formatted
};

function skipMessage(message, context) {
    if (!context) return true;
    if (process.env.LOG_SUBSYSTEM) {
        let allowedSubsystems = process.env.LOG_SUBSYSTEM.split(',');
        return !allowedSubsystems.includes(context.subsystem);
    }

    return false;
}


var logger = {
    init,
    log: function (level, context, message) {
        if (!winstonLogger) return;
        if (skipMessage(message, context)) return;
        winstonLogger.log(level, message, formatMessage(context));
    },
    error: function (context, message) {
        if (!winstonLogger) return;
        if (skipMessage(message, context)) return;
        winstonLogger.error(message, formatMessage(context));
    },
    warn: function (context, message) {
        if (!winstonLogger) return;
        if (skipMessage(message, context)) return;
        winstonLogger.warn(message, formatMessage(context));
    },
    verbose: function (context, message) {
        if (!winstonLogger) return;
        if (skipMessage(message, context)) return;
        winstonLogger.verbose(message, formatMessage(context));
    },
    info: function (context, message) {
        if (!winstonLogger) return;
        if (skipMessage(message, context)) return;
        winstonLogger.info(message, formatMessage(context));
    },
    debug: function (context, message) {
        if (!winstonLogger) return;
        if (skipMessage(message, context)) return;
        winstonLogger.debug(message, formatMessage(context));
    }
};

module.exports = logger;
