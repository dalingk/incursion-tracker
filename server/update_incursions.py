import os
import requests
import sqlite3
import uuid
from pprint import pprint

DB_FILE = os.environ.get('DB_FILE', 'incursion.db')
API_URL = 'https://esi.evetech.net/latest/incursions?datasource=tranquility'

data = requests.get(API_URL)
data.raise_for_status()
staging_systems = {}
for incursion in data.json():
    staging_id = incursion['staging_solar_system_id']
    system = requests.get(
        'https://esi.evetech.net/latest/universe/systems/{}?datasource=tranquility'.format(staging_id)
    )
    system.raise_for_status()
    staging_systems[staging_id] = system.json()

def establish_incursion(cursor, constellation_id, state, security):
    """Establish a new incursion in the database."""
    inc_uuid = uuid.uuid4()
    cursor.execute(
        'INSERT INTO current_incursion (uuid, constellation_id, state, current, security)'
        ' VALUES (?, ?, ?, ?, ?)', (
            inc_uuid.bytes, constellation_id, state, True, security
        )
    )
    change_state(cursor, inc_uuid, state)
    return inc_uuid

def change_state(cursor, incursion_id, new_state):
    """Change state of current incursion."""
    cursor.execute('INSERT INTO state_changes (uuid, state) VALUES (?, ?)', (incursion_id.bytes, new_state))
    if new_state in ['established', 'mobilizing', 'withdrawing', 'defeated']:
        cursor.execute('UPDATE current_incursion set state = ? where uuid = ?;', (new_state, incursion_id.bytes))
    elif new_state == 'boss':
        cursor.execute('UPDATE current_incursion set has_boss = 1 where uuid = ?;', (incursion_id.bytes,))
    else:
        print('Error setting incursion {} to state {}'.format(incursion_id, new_state))

def defeat_incursion(cursor, constellation_id):
    """Defeat incursion."""
    cursor.execute('INSERT INTO state_changes (uuid, state) SELECT uuid, \'defeated\' from current_incursion WHERE constellation_id = ? AND current = 1;', (constellation_id,))
    cursor.execute('UPDATE current_incursion SET current = 0, state = \'defeated\' WHERE uuid = (SELECT uuid FROM current_incursion WHERE constellation_id = ? AND current = 1);', (constellation_id,))


with sqlite3.connect(DB_FILE) as conn:
    cursor = conn.cursor()
    cursor.execute('CREATE TABLE IF NOT EXISTS current_incursion (uuid blob, constellation_id integer, state text, current integer, has_boss integer default 0, security text);')
    cursor.execute('CREATE TABLE IF NOT EXISTS state_changes (uuid blob, time text default current_timestamp, state text);')
    cursor.execute('CREATE INDEX IF NOT EXISTS current_incursion_uuid_idx on current_incursion (uuid);')
    cursor.execute('CREATE INDEX IF NOT EXISTS state_changes_uuid_idx on state_changes (uuid);')
    cursor.execute('SELECT current_incursion.uuid, constellation_id, current_incursion.state, has_boss FROM current_incursion where current_incursion.current = 1;')
    cursor_data = cursor.fetchall()
    stored_incursions = {x[1]: {'uuid': uuid.UUID(bytes=x[0]), 'constellation_id': x[1], 'state': x[2], 'has_boss': x[3]} for x in cursor_data}
    eve_incursions = data.json()
    for item in eve_incursions:
        if item['constellation_id'] not in stored_incursions:
            staging_security = round(staging_systems[item['staging_solar_system_id']]['security_status'], 1)
            security_name = 'high'
            if staging_security < 0.1:
                security_name = 'null'
            elif staging_security < 0.5:
                security_name = 'low'
            establish_incursion(cursor, item['constellation_id'], item['state'], security_name)
        if item['constellation_id'] in stored_incursions:
            constellation = item['constellation_id']
            stored = stored_incursions[constellation]
            if stored['state'] != item['state']:
                change_state(cursor, stored['uuid'], item['state'])
            if stored['has_boss'] != item['has_boss']:
                change_state(cursor, stored['uuid'], 'boss')
    eve_incursion_set = set([x['constellation_id'] for x in eve_incursions])
    defeated_incursions = set(stored_incursions) - eve_incursion_set
    for constellation_id in defeated_incursions:
        defeat_incursion(cursor, constellation_id)
        

