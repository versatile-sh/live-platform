#!/bin/bash
# 1 h healthy run: 1 server + 8 clients, each in its own container (own netns), tc netem loss 2% on every eth0 (so 2% each direction)
set -u
B=$1; L=$2
docker run -d --rm --init --name sh-server --network s1net --ip 172.30.0.50 --cap-add NET_ADMIN -v $B:/b:ro spike-net:1 sh -c 'tc qdisc add dev eth0 root netem loss 2% && exec /b/s1server -ip 172.30.0.50' >/dev/null
sleep 1
for i in 1 2 3 4 5 6 7 8; do
  docker run -d --rm --init --name sh-c$i --network s1net --ip 172.30.0.$((50+i)) --cap-add NET_ADMIN -v $B:/b:ro spike-net:1 sh -c "tc qdisc add dev eth0 root netem loss 2% && exec timeout 3720 /b/s1client -name c$i -room healthy -server ws://172.30.0.50:8080/ws" >/dev/null
  sleep 0.5
done
date +%s%N > $L/healthy_start_ns
