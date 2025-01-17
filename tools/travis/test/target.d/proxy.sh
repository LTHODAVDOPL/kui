#!/usr/bin/env bash

#
# Copyright 2019 IBM Corporation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

#
# When testing locally on a laptop:
#   PORT=8081 KUI_USE_HTTP=true ~/git/kui/tools/travis/test/target.d/proxy.sh
#
# When in travis, this is spawned by ./webpack.sh
#

set -e
set -o pipefail

SCRIPTDIR=$(cd $(dirname "$0") && pwd)

if [ -n "$1" ]; then
    ROOT=$(cd "$1" && pwd)
else
    ROOT=..
fi

start() {
    PID=$(echo $$)
    echo "$PID" > /tmp/kuiproxy.pid
    echo "start proxy $PID"

    cd "$ROOT"/kui/packages/proxy && ./app/bin/www &
    SUB=$!
    echo $SUB > /tmp/kuiproxy_subprocess.pid

    wait $SUB
}

stop() {
    PID=$(cat /tmp/kuiproxy_subprocess.pid)
    echo "stop proxy $PID"
    kill $PID

    set -e
    sleep 2
    PID=$(ps aux | grep www | grep -v grep| awk '{ print $2 }')
    kill $PID
    set +e
}

fakecrash() {
    echo "fakecrash proxy"
    stop
    sleep 10
    start
}

trap fakecrash SIGHUP
start
