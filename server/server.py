import os
import uuid
import aiosqlite
from sanic import Sanic
from sanic.response import json

DB_FILE = os.environ.get('DB_FILE', 'incursion.db')
SANIC_PORT = int(os.environ.get('SANIC_PORT', 3000))
SANIC_HOST = os.environ.get('SANIC_HOST', '0.0.0.0')
SANIC_SOCKET = os.environ.get('SANIC_SOCKET', None)
SANIC_LOG = os.environ.get('SANIC_LOG', 'True') == 'False'
app = Sanic()

async def get_incursion_data():
    """Parse incursions into a cohesive dictionary object."""
    incursions = {}
    async with aiosqlite.connect(DB_FILE) as db:
        cursor = await db.execute('SELECT current_incursion.uuid, constellation_id, current_incursion.state, has_boss, state_changes.state, state_changes.time FROM current_incursion join state_changes on state_changes.uuid = current_incursion.uuid where current_incursion.current = 1;')
        data = await cursor.fetchall()
        for x in data:
            if x[1] not in incursions:
                incursions[x[1]] = {'uuid': str(uuid.UUID(bytes=x[0])), 'constellation_id': x[1], 'state': x[2], 'has_boss': bool(x[3]), 'last_states': {x[4]: x[5]}}
            else:
                incursions[x[1]]['last_states'][x[4]] = x[5]
    return incursions
    
    

@app.route('/')
async def test(request):
    return json(await get_incursion_data())

if __name__ == '__main__':
    app.run(host=SANIC_HOST, port=SANIC_PORT, access_log=SANIC_LOG)