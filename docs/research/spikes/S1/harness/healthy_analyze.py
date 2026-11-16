#!/usr/bin/env python3
"""Analyse the 1 h healthy run from the 8 client logs and the server log."""
import json, sys, collections
d = sys.argv[1]
res = {}
dup = reuse = rvbad = 0; roster_msgs = 0; nonactive = 0; removals = 0
finals = {}
for i in range(1, 9):
    lastrv = 0; seen = set(); gone = set(); last = None; first = None
    for l in open(f'{d}/client_c{i}.jsonl'):
        try: e = json.loads(l)
        except Exception: continue
        if e.get('k') != 'roster_rx': continue
        m = e['msg']; roster_msgs += 1
        if m['rv'] <= lastrv: rvbad += 1
        lastrv = m['rv']
        pids = [x['pid'] for x in m['roster']]; names = [x['name'] for x in m['roster']]
        if len(set(pids)) != len(pids) or len(set(names)) != len(names): dup += 1
        cur = set(pids)
        if gone & cur: reuse += 1
        gone |= (seen - cur); seen |= cur
        if any(x['state'] == 'reconnecting' for x in m['roster']): nonactive += 1
        last = m
    finals[f'c{i}'] = sorted(x['name'] + ':' + x['state'] for x in last['roster']) if last else None
    removals += len(gone)
srv = collections.Counter()
for l in open(f'{d}/server_state.jsonl'):
    e = json.loads(l); srv[(e['from'], e['to'], e['why'])] += 1
print(json.dumps(dict(roster_messages_seen_by_clients=roster_msgs, duplicate_roster_versions=dup, pid_reappeared=reuse, rv_not_increasing=rvbad,
  messages_showing_reconnecting=nonactive, removals_seen_by_clients=removals, server_transitions={'%s>%s:%s' % k: v for k, v in srv.items()},
  final_roster_c1=finals['c1'], all_clients_final_rosters_equal=len({json.dumps(v) for v in finals.values()}) == 1)))
