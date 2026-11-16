#!/bin/bash
# 1 h healthy run: 1 server + 8 clients, each in its own container (own netns), tc netem loss 2% on every eth0 (so 2% each direction)
set -u
B=$1; L=$2
IDS=$L/container_ids.txt; : > $IDS
SECS=${SECS:-900}
docker run -d --rm --init --name s1bh-server --network s1bnet --ip 172.30.0.50 --cap-add NET_ADMIN -v $B:/b:ro spike-net-s1b:1 sh -c "tc qdisc add dev eth0 root netem loss 2% && exec /b/s1server -ip 172.30.0.50 ${SARGS:-}" >>$IDS
sleep 1
for i in 1 2 3 4 5 6 7 8; do
  docker run -d --rm --init --name s1bh-c$i --network s1bnet --ip 172.30.0.$((50+i)) --cap-add NET_ADMIN -v $B:/b:ro spike-net-s1b:1 sh -c "tc qdisc add dev eth0 root netem loss 2% && exec timeout $((SECS+120)) /b/s1client -name c$i -room healthy -server ws://172.30.0.50:8080/ws" >>$IDS
  sleep 0.5
done
date +%s%N > $L/healthy_start_ns
sleep $SECS
docker exec s1bh-server tc -s qdisc show dev eth0 > $L/netem_counters.txt 2>&1
docker exec s1bh-c1 tc -s qdisc show dev eth0 >> $L/netem_counters.txt 2>&1
i=0
for id in $(sed -n '2,9p' $IDS); do i=$((i+1)); docker logs $id > $L/client_c$i.jsonl 2>&1; done
docker logs $(sed -n 1p $IDS) 2>&1 | grep '"k":"state"' > $L/server_state.jsonl
docker logs $(sed -n 1p $IDS) 2>&1 | grep -c '"k":"inbox_full"' > $L/inbox_full_count.txt
docker rm -f $(cat $IDS) >/dev/null 2>&1
echo done
