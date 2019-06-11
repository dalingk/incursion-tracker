import sqlite3
import requests
from collections import namedtuple
from enum import Enum
from pprint import pprint

class SystemSecurity(Enum):
    HIGH = 1
    LOW = 2
    NULL = 3

SecurityCounts = namedtuple('SecurityCounts', ['high', 'low', 'null'])

with sqlite3.connect('incursion.db') as conn:
    cursor = conn.cursor()
    cursor.execute('SELECT distinct(constellation_id) from current_incursion where security is null;')
    for (constellation_id,) in cursor.fetchall():
        constellation_json = requests.get(
            'https://esi.evetech.net/latest/universe/constellations/{}'.format(constellation_id)
        ).json()
        (high, low, null) = (0, 0, 0)
        for system_id in constellation_json['systems']:
            try:
                system_json = requests.get(
                    'https://esi.evetech.net/latest/universe/systems/{}'.format(system_id)
                ).json()
            except:
                print('Failed parsing JSON for system {}'.format(system_id))
                continue
            rounded_security = round(system_json['security_status'], 2)
            if rounded_security < 0.0:
                null += 1
            elif rounded_security < .5:
                low += 1
            else:
                high += 1
        _, security_class = max(zip((high, low, null), ['high', 'low', 'null']), key=lambda x: x[0])
        cursor.execute('UPDATE current_incursion set security = ? where constellation_id = ?', (security_class, constellation_id))
        print('{}: {}'.format(constellation_id, security_class))
        # pprint(sec_counts)

