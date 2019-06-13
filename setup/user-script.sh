# This is the zone user-script that will be run once on instance create.
apk update
apk add bash
apk add curl
apk add openssl
apk add openssh
apk add docker

# Install docker compose.
curl -sS -L https://github.com/docker/compose/releases/download/1.24.0/docker-compose-Linux-x86_64 -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Get the sdc-docker-setup script.
mkdir -p /root/bin
if [[ ! -x /root/bin/sdc-docker-setup.sh ]]; then
    curl -sS -L -o /root/bin/sdc-docker-setup.sh https://raw.githubusercontent.com/joyent/sdc-docker/master/tools/sdc-docker-setup.sh
    chmod +x /root/bin/sdc-docker-setup.sh
fi

# Create docker wrapper script.
cat > /root/bin/docker <<EOF
source /root/.sdc/docker/jill/env.sh
/usr/bin/docker "\$@"
EOF
chmod +x /root/bin/docker

# Create docker-compose wrapper script.
cat > /root/bin/docker-compose <<EOF
source /root/.sdc/docker/jill/env.sh
/usr/local/bin/docker-compose "\$@"
EOF
chmod +x /root/bin/docker-compose

# Add wrapper scripts to the path.
echo "export PATH=\$PATH:/root/bin" > /root/.profile

# Get the docker compose tracing definitions.
cat > /root/docker-compose-tracing.yml <<EOF
version: "2.4"

services:
  cassandra:
    container_name: tracing-database-cassandra
    image: openzipkin/zipkin-cassandra
    mem_limit: 2G
    network_mode: "bridge"
    restart: always
    labels:
      triton.cns.services: "tracing-database-cassandra"
    # Uncomment to expose the storage port for testing
    # ports:
    #   - 9042:9042

  # Adds a cron to process spans since midnight every hour, and all spans each day
  # This data is served by http://192.168.99.100:8080/dependency
  #
  # For more details, see https://github.com/openzipkin/docker-zipkin-dependencies
  dependencies:
    image: openzipkin/zipkin-dependencies
    container_name: tracing-dependency-analyzer
    mem_limit: 2G
    network_mode: "bridge"
    restart: always
    entrypoint: crond -f
    environment:
      - STORAGE_TYPE=cassandra3
      - CASSANDRA_CONTACT_POINTS=cassandra
      # Uncomment to see dependency processing logs
      - ZIPKIN_LOG_LEVEL=DEBUG
      # Uncomment to adjust memory used by the dependencies job
      # - JAVA_OPTS=-verbose:gc -Xms1G -Xmx1G
    links:
      - cassandra
    depends_on:
      - cassandra

  zipkin:
    container_name: tracing-zipkin
    image: openzipkin/zipkin
    mem_limit: 2G
    network_mode: "bridge"
    restart: always
    links:
      - cassandra
    environment:
      - STORAGE_TYPE=cassandra3
      # When using the test docker image, or have schema pre-installed, you don't need to re-install it
      - CASSANDRA_ENSURE_SCHEMA=false
      # When overriding this value, note the minimum supported version is 3.9
      # If you you cannot run 3.9+, but can run 2.2+, set STORAGE_TYPE=cassandra
      - CASSANDRA_CONTACT_POINTS=cassandra
    labels:
      triton.cns.services: "tracing-zipkin"
    ports:
      # Port used for the Zipkin UI and HTTP Api
      - 9411:9411
    depends_on:
      - cassandra

EOF

touch /var/log/userscript-is-complete
