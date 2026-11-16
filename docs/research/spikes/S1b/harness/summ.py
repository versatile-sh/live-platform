import json,sys
d=sys.argv[1]
for c in "clean kill9 sigstop hbstop dropall dropudp resume2 resume35 resume5".split():
    try: a=json.load(open(f'{d}/{c}/analysis.json'))
    except Exception: continue
    r=a['removed_obs1']; r2=a['removed_obs2']
    print(c,'rem',r.get('n'),r.get('min'),r.get('max'),'obs2max',r2.get('max'),'| susp',a['suspect_obs1'].get('min'),a['suspect_obs1'].get('max'),'| act',a['active_again_obs1'].get('n'),a['active_again_obs1'].get('min'),a['active_again_obs1'].get('max'),'| ice2',a['ice_connected_gen2'].get('max'),'| rej',a['client_rejoin_prompt'],a['final_state_obs1'],a['server_transitions'],a['duplicate_roster_versions'],a['pid_reappeared_after_removal'],a['rv_not_increasing'])
