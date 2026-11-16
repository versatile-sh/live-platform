#!/bin/bash
# usage: s2run.sh <scenario> <measure-seconds>   (SFU container: host networking, --cpus=1, bound to 172.31.0.1 only)
set -u
SC=$1; MEAS=${2:-60}; GML=${3:-}; LABEL=$SC${GML:+-gml$GML}; B=$(dirname $(readlink -f $0))/bin; OUT=$(dirname $(readlink -f $0))/logs/$LABEL; mkdir -p $OUT; rm -f $OUT/stats_series.jsonl $OUT/cpu_series.txt
export TURN_SECRET=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
SFU=$(docker run -d --rm --network host --cpus=1 --memory=2g -e TURN_SECRET ${GML:+-e GOMEMLIMIT=$GML} -v $B:/b:ro spike-net:1 /b/s2 sfu -bind 172.31.0.1 -scenario $SC -turn ip)
sleep 2
cpu() { docker exec $SFU sh -c 'grep -E "usage_usec|nr_throttled|throttled_usec|nr_periods" /sys/fs/cgroup/cpu.stat' | tr '\n' ' '; }
st() { curl -s http://172.31.0.1:8080/stats; }
echo "# idle" > $OUT/summary.txt; st | tee $OUT/stats_idle.json > /dev/null
docker exec $SFU cat /sys/fs/cgroup/cpu.max > $OUT/cpu.max
setsid $B/s2 load -server 172.31.0.1:8080 -scenario $SC -dur $((MEAS+60))s > $OUT/load.log 2>&1 &
LOADPID=$!
for k in $(seq 1 60); do
  a=$(st | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['subs_done'],d['pcs'])"); 
  n=$(python3 -c "from sys import argv; print({'video30':30,'video30full':30,'audio100':100}[argv[1]])" $SC)
  [ "${a%% *}" = "$n" ] && break; sleep 1
done
echo "negotiated after ${k}s: subs_done/pcs=$a" | tee -a $OUT/summary.txt
sleep 10   # ramp / settle
st > $OUT/stats_start.json; c0=$(cpu); t0=$(date +%s.%N)
for k in $(seq 1 $((MEAS/5))); do sleep 5; st >> $OUT/stats_series.jsonl; echo "$(date +%s.%N) $(cpu)" >> $OUT/cpu_series.txt; done
st > $OUT/stats_end.json; c1=$(cpu); t1=$(date +%s.%N)
curl -s "http://172.31.0.1:8080/stats?gc=1" > $OUT/stats_end_gc.json
curl -s http://172.31.0.1:8080/debug/pprof/heap?debug=0 -o $OUT/heap.pb.gz
echo "cpu_start: $c0" >> $OUT/summary.txt; echo "cpu_end: $c1" >> $OUT/summary.txt; echo "wall: $t0 $t1" >> $OUT/summary.txt
kill $LOADPID 2>/dev/null; docker logs $SFU > $OUT/sfu.log 2>&1
docker stop -t 3 $SFU >/dev/null
