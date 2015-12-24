FROM node:4

MAINTAINER Aleksandr Popov  <mogadanez@gmail.com>

# Create sqsd directory
WORKDIR /
RUN mkdir /sqsd

# Copy sqsd source including
COPY ./ /sqsd

# Run sqsd
WORKDIR /sqsd
CMD ["node", "run-cli.js"]

