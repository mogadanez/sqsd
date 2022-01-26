FROM node:14-slim
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

