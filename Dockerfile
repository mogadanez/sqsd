FROM node:4

MAINTAINER Aleksandr Popov  <mogadanez@gmail.com>

# Create sqsd directory
WORKDIR /
RUN mkdir /sqsd
WORKDIR /sqsd

# Copy sqsd source including
COPY ./ /sqsd

# Install dependencies
RUN npm install

# Run sqsd
CMD ["node", "run-cli.js"]

