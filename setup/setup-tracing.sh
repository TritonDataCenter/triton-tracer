#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Copyright 2019 Joyent, Inc.
#

#
# This tool works to setup triton tracing on a test machine which has been
# setup with trentops:bin/coal-post-setup.sh or another similar mechanism (e.g.
# globe-theatre nightly setup).
#
# On a new coal, run coal-post-setup.sh, then:
#
#  scp ./setup-tracing.sh coal:/var/tmp/
#  ssh coal /var/tmp/setup-tracing.sh
#
# and you should be able to then go to the zipkin tracing page that gets spit
# out at the end. After that, triton actions like instance provisioning and
# deletion should be visible in the zipkin pages.
#
# Overview of script actions:
#  1. Updates Triton components to latest rfd-35-cls branch code.
#  2. Creates an LX (Alpine) container and installs docker tools in it.
#  3. Sets up user 'jill' to access sdc-docker from the alpine container.
#  4. Uses docker-compose in the alpine container to launch 3 zipkin containers
#     (database, zipkin and zipkin-analyzer).
#

IMAGE_UUID="19aa3328-0025-11e7-a19a-c39077bfd4cf" # LX Alpine 3: 20170303
MIN_MEMORY=256
ALIAS=tracing-docker-setup-helper

if [[ -n "${TRACE}" ]]; then
    set -o xtrace
fi
set -o errexit
set -o pipefail

if [[ $1 == "--debug" ]]; then
    set -o xtrace
fi

function fatal() {
    echo "FATAL: $*" >&2
    exit 1
}

PATH=/usr/bin:/usr/sbin:/smartdc/bin:/opt/smartdc/bin

# Install the RFD 35 branches.
for name in docker cloudapi vmapi cnapi workflow papi napi imgapi
do
    uuid=$(updates-imgadm list -H -o uuid -C experimental "name=$name" version=~rfd-35-cls- | tail -1)
    sdcadm up -y -C experimental "$name@$uuid"
done

# Install the RFD 35 cn-agent (hack - is there a better way?).
uuid=$(updates-imgadm list -C experimental name=cn-agent -j | json -ga -c 'this.tags.buildstamp.substr(0, 15) === "rfd-35-cls-2019"' uuid | tail -1)
current_uuid=$(cat /opt/smartdc/agents/lib/node_modules/cn-agent/image-uuid)
if [[ $uuid != $current_uuid ]]; then
    filepath=/var/tmp/rfd-35-cls-cn-agent.tar.gz
    updates-imgadm get-file -C experimental "$uuid" > "$filepath"
    rm -rf /opt/smartdc/agents/lib/node_modules/cn-agent.orig
    mv /opt/smartdc/agents/lib/node_modules/cn-agent /opt/smartdc/agents/lib/node_modules/cn-agent.orig
    tar xzf "$filepath" -C /opt/smartdc/agents/lib/node_modules
    echo "$uuid" > /opt/smartdc/agents/lib/node_modules/cn-agent/image-uuid
fi

# TODO: Install cn-agent on CN's too.

# Check if the tracing docker vm is already installed:
lxzone=$(vmadm lookup alias=$ALIAS)
if [[ -z "$lxzone" ]]; then

  # Find admin uuid
  admin_uuid=$(sdc-useradm get admin | json uuid)

  # Find package
  # - Exclude packages with "brand" set to limit to a provision of a particular
  #   brand (e.g. brand=bhyve ones that have shown up recently for flexible
  #   disk support).
  package_uuid=$(sdc-papi /packages \
      | json -c '!this.brand' -Ha uuid max_physical_memory \
      | sort -n -k 2 \
      | while read uuid mem; do
        # Find the first one with at least MIN_MEMORY
        if [[ -z ${pkg} && ${mem} -ge ${MIN_MEMORY} ]]; then
            pkg=${uuid}
            echo ${uuid}
        fi
      done
  )

  # Setup a sdc-docker access container, in which we can launch docker commands.

  echo "Admin account: ${admin_uuid}"
  echo "Package: ${package_uuid}"

  # Import the image prior to creating the instance.
  sdc-imgadm import -S https://images.joyent.com "${IMAGE_UUID}" || echo "Image already installed"

  # Download and convert the vm user-script to JSON format.
  userscript=$(curl -k --fail -sS -L https://raw.githubusercontent.com/joyent/triton-tracer/rfd-35-cls/setup/user-script.sh | \
    /opt/smartdc/agents/lib/node_modules/cn-agent/node/bin/node -p \
    'var fs = require("fs"); JSON.stringify(fs.readFileSync(0).toString())')

  echo "Creating ${ALIAS} VM"

  lxzone=$(sdc-vmapi /vms?sync=true -X POST -d@/dev/stdin <<PAYLOAD | json -H vm_uuid message
  {
    "alias": "${ALIAS}",
    "brand": "lx",
    "owner_uuid": "${admin_uuid}",
    "kernel_version": "3.13.0",
    "billing_id": "${package_uuid}",
    "image_uuid": "${IMAGE_UUID}",
    "resolvers": ["8.8.8.8","8.8.4.4"],
    "networks": [
      {
        "name": "external",
        "primary": true
      }
    ],
    "customer_metadata": {
      "user-script": $userscript
    }
  }
PAYLOAD
  )

  if [[ -z $lxzone ]]; then
    fatal "Unable to create lx docker zone"
  fi

  if [[ ! $lxzone =~ ^\{?[A-F0-9a-f]{8}-[A-F0-9a-f]{4}-[A-F0-9a-f]{4}-[A-F0-9a-f]{4}-[A-F0-9a-f]{12}\}?$ ]]; then
    fatal "Unable to create lx docker zone: ${lxzone}"
  fi
fi

# Wait for the user-script to complete.
userscript_complete=
for iteration in {1..60}; do
    if [[ -f "/zones/${lxzone}/root/var/log/userscript-is-complete" ]]; then
        userscript_complete=1
        break
    fi
    echo " ... waiting for zone userscript to finish ..."
    sleep 1
done

if [[ -z $userscript_complete ]]; then
    fatal "${alias} userscript did not complete within one minute"
fi

# Setup jill to access sdc-docker from the lx zone.
mkdir -p "/zones/${lxzone}/root/root/.ssh"
cp /root/.ssh/automation.id_rsa* "/zones/${lxzone}/root/root/.ssh/"
cloudapi_ip=$(vmadm lookup -1 -j alias=cloudapi0 | json -ga nics | json -ga -c 'this.nic_tag === "external"' ip)
zlogin "${lxzone}" /root/bin/sdc-docker-setup.sh -k "${cloudapi_ip}" jill /root/.ssh/automation.id_rsa

# Launch docker compose to create the zipkin containers.
zlogin "${lxzone}" /root/bin/docker-compose -f /root/docker-compose-tracing.yml up -d

# Create the ziploader service.
rm -rf /opt/custom/ziploader
mkdir -p /opt/custom/ziploader
cd /opt/custom/ziploader
updates-imgadm get-file -C experimental -o /tmp/ziploader.$$.tgz \
    $(updates-imgadm list --latest -C experimental -H -o uuid name=ziploader)
tar -zxf /tmp/ziploader.$$.tgz
rm /tmp/ziploader.$$.tgz

# Find the IP of the docker zipkin instance.
zipkin_ip=$(zlogin "${lxzone}" /root/bin/docker inspect --format='{{.NetworkSettings.IPAddress}}' tracing-zipkin)

if [[ -z $zipkin_ip ]]; then
    fatal "Could not obtain the zipkin server address"
fi

# Start the ziploader, pointing at this zipkin instance.
cd /opt/custom/ziploader && nohup ziploader.js -H "${zipkin_ip}" &

echo "* * * Successfully setup tracing * * *"
echo "Zipkin: http://${zipkin_ip}:9411/"

zlogin "${lxzone}" touch /var/log/tracing-helper-is-setup

exit 0
