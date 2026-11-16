#!/bin/bash
# usage: s2turn.sh <mode default|ip|ipport>
M=$1; B=$(dirname $(readlink -f $0))/bin; OUT=$(dirname $(readlink -f $0))/logs/turn-$M; mkdir -p $OUT
export TURN_SECRET=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
SFU=$(docker run -d --rm --network host --cpus=1 -e TURN_SECRET -v $B:/b:ro spike-net:1 /b/s2 sfu -bind 172.31.0.1 -scenario relay1 -turn $M -relaylog)
sleep 2
echo "## turntest (mode=$M)" | tee $OUT/turntest.txt
timeout 60 $B/s2 turntest -bind 172.31.0.1 2>&1 | tee -a $OUT/turntest.txt
echo "## relaytest (mode=$M): one client, relay-only ICE policy, publishes audio through TURN to the SFU mux" | tee $OUT/relaytest.txt
curl -s http://172.31.0.1:8080/stats > $OUT/stats_before_relay.json
timeout 60 $B/s2 relaytest -server 172.31.0.1:8080 -turnip 172.31.0.1 2>&1 | tail -5 | tee -a $OUT/relaytest.txt
curl -s http://172.31.0.1:8080/stats > $OUT/stats_after_relay.json
python3 -I -c "
import json;a=json.load(open('$OUT/stats_before_relay.json'));b=json.load(open('$OUT/stats_after_relay.json'));print('sfu rtp_in before',a['rtp_in'],'after',b['rtp_in'])" | tee -a $OUT/relaytest.txt
docker logs $SFU > $OUT/sfu.log 2>&1; docker stop -t 3 $SFU > /dev/null
