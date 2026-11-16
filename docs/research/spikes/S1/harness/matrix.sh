#!/bin/bash
# S1 kill matrix. usage: matrix.sh <bindir> <logdir> <case>...
# 1 server container, 2 observer containers, 20 target containers (one netns each), same host clock.
B=$1; L=$2; shift 2
N=20
SRV=172.30.0.10
up() {
  docker run -d --rm --init --name s1-server --network s1net --ip $SRV -v $B:/b:ro spike-net:1 /b/s1server -ip $SRV ${SARGS:-} >/dev/null
  for o in 1 2; do docker run -d --rm --init --name s1-obs$o --network s1net --ip 172.30.0.1$o --cap-add NET_ADMIN -v $B:/b:ro spike-net:1 sleep 3000 >/dev/null; done
  for i in $(seq 1 $N); do docker run -d --rm --init --name s1-t$(printf %02d $i) --network s1net --ip 172.30.0.$((20+i)) --cap-add NET_ADMIN -v $B:/b:ro spike-net:1 sleep 3000 >/dev/null & done; wait
}
start() { # container name room extra-args
  docker exec -d $1 sh -c "echo \$\$ > /tmp/pid; exec /b/s1client -name $2 -room $3 -server ws://$SRV:8080/ws $4 > /tmp/client.log 2>&1"
}
runcase() {
  c=$1; room=$c; mkdir -p $L/$c
  extra=""; [ "$c" = resume3 ] && extra="-resume-delay 3s"; [ "$c" = resume9 ] && extra="-resume-delay 9s"
  for o in 1 2; do start s1-obs$o obs$o $room ""; sleep 0.3; done
  for i in $(seq 1 $N); do start s1-t$(printf %02d $i) t$(printf %02d $i) $room "$extra" & sleep 0.1; done; wait
  # wait until the 20 targets are active (check obs1 log)
  for k in $(seq 1 60); do
    n=$(docker exec s1-obs1 sh -c 'tail -n1 /tmp/client.log' | python3 -c "
import sys,json
l=sys.stdin.read().strip()
try:
  m=json.loads(l)['msg']['roster']; print(sum(1 for e in m if e['name'].startswith('t') and e['state']=='active'))
except Exception: print(0)")
    [ "$n" = "$N" ] && break; sleep 1
  done
  echo "case $c: $n/$N active after ${k}s"; sleep 9   # let hb run, two server pings
  case $c in
   clean) act='kill -TERM $(cat /tmp/pid)';;
   kill9) act='kill -9 $(cat /tmp/pid)';;
   sigstop) act='kill -STOP $(cat /tmp/pid)';;
   hbstop) act='kill -USR1 $(cat /tmp/pid)';;
   dropall) act='iptables -I INPUT -j DROP; iptables -I OUTPUT -j DROP';;
   dropudp) act='iptables -I INPUT -p udp -j DROP; iptables -I OUTPUT -p udp -j DROP';;
   resume3|resume9) act='kill -USR2 $(cat /tmp/pid)';;
   drop3) act='iptables -I INPUT -j DROP; iptables -I OUTPUT -j DROP; sleep 3; iptables -F';;
   drop9) act='iptables -I INPUT -j DROP; iptables -I OUTPUT -j DROP; sleep 9; iptables -F';;
  esac
  for i in $(seq 1 $N); do
    t=s1-t$(printf %02d $i)
    ( docker exec $t python3 /b/ev.py "$act" > $L/$c/t0_t$(printf %02d $i).txt 2>&1 ) &
  done; wait
  win=45; [ $c = clean ] && win=8
  sleep $win
  docker exec s1-obs1 cat /tmp/client.log > $L/$c/obs1.jsonl
  docker exec s1-obs2 cat /tmp/client.log > $L/$c/obs2.jsonl
  for i in $(seq 1 $N); do t=s1-t$(printf %02d $i); docker exec $t cat /tmp/client.log > $L/$c/client_t$(printf %02d $i).jsonl 2>/dev/null; done
  docker logs s1-server 2>&1 > $L/$c/server_all.jsonl   # cumulative; filtered per room in analysis
  # cleanup: stop only our client PIDs (from pid files), unfreeze, flush rules
  for t in s1-obs1 s1-obs2 $(for i in $(seq 1 $N); do echo s1-t$(printf %02d $i); done); do
    docker exec $t sh -c 'p=$(cat /tmp/pid 2>/dev/null); [ -n "$p" ] && { kill -CONT $p 2>/dev/null; kill -9 $p 2>/dev/null; }; iptables -F; rm -f /tmp/pid /tmp/client.log' &
  done; wait
  sleep 2
}
docker rm -f s1-server s1-obs1 s1-obs2 $(for i in $(seq 1 $N); do echo s1-t$(printf %02d $i); done) >/dev/null 2>&1
up; sleep 2
for c in "$@"; do runcase $c; done
docker logs s1-server > $L/server_full.jsonl 2>&1
docker rm -f s1-server s1-obs1 s1-obs2 $(for i in $(seq 1 $N); do echo s1-t$(printf %02d $i); done) >/dev/null 2>&1
echo done
