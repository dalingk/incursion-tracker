import * as ESI from './esiDefinitions';

const securityColors = Object.freeze([
    '#F00000',
    '#D73000',
    '#F04800',
    '#F06000',
    '#D77700',
    '#EFEF00',
    '#8FEF2F',
    '#00F000',
    '#00EF47',
    '#48F0C0',
    '#2FEFEF'
]);

function sleep(ms: number) {
    return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

function fromEntries(iterable: any[]) {
    return [...iterable].reduce(
        (obj, [key, value]) => Object.assign(obj, { [key]: value }),
        {}
    );
}

class ESIData {
    private db: IDBDatabase;
    private cacheExpireDate: Date;
    private bouncer: Map<string, Promise<any>>;
    private sovUpdate: Promise<boolean>;
    private historyData: Promise<ESI.IncursionHistory>;
    constructor(db: IDBDatabase) {
        this.db = db;
        let today = new Date();
        today.setDate(today.getDate() - 30);
        this.cacheExpireDate = today;
        this.bouncer = new Map();
        this.sovUpdate = this.initSov();
        this.historyData = this.loadHistory();
    }
    private checkCache(storeName: string, key: any): Promise<any> {
        let objectStore = this.db
            .transaction(storeName, 'readonly')
            .objectStore(storeName);
        let request = objectStore.get(key);
        return new Promise((resolve, reject) => {
            request.onsuccess = event => {
                resolve(request.result);
            };
            request.onerror = event => {
                reject(event);
            };
        });
    }
    private async fetchJSON(route: string, fields?: Array<Array<string>>) {
        fields = fields || [];
        fields.push(['datasource', 'tranquility']);
        let queryString = new URLSearchParams(fields);
        let queryURL = `https://esi.evetech.net/latest/${route}/?${queryString}`;
        let bouncedRequest = this.bouncer.get(queryURL);
        if (bouncedRequest) {
            return await bouncedRequest;
        }
        try {
            this.bouncer.set(
                queryURL,
                new Promise((resolve, reject) => {
                    let response = fetch(queryURL)
                        .then(response => response.json())
                        .then(data => {
                            resolve(data);
                            this.bouncer.delete(queryURL);
                        })
                        .catch(err => reject(err));
                })
            );
            return await this.bouncer.get(queryURL);
        } catch {
            let errorDiv = document.createElement('div');
            errorDiv.classList.add('error');
            errorDiv.appendChild(
                new Text('Unable to retrieve data from Eve APIs.')
            );
            document.body.appendChild(errorDiv);
        }
    }
    async incursionData(): Promise<Array<ESI.Incursion>> {
        return await this.fetchJSON('incursions');
    }
    async constellationData(
        constellationID: number
    ): Promise<ESI.Constellation> {
        let constellationCache = await this.checkCache(
            'constellation',
            constellationID
        );
        if (
            constellationCache &&
            constellationCache.date &&
            constellationCache.date.getTime() > this.cacheExpireDate.getTime()
        ) {
            return constellationCache;
        } else {
            let constellationJSON = await this.fetchJSON(
                `universe/constellations/${constellationID}`
            );
            let constellationStore = this.db
                .transaction('constellation', 'readwrite')
                .objectStore('constellation');
            constellationJSON.date = new Date();
            constellationStore.put(constellationJSON);
            return constellationJSON;
        }
    }
    async regionData(regionID: number): Promise<ESI.Region> {
        let regionCache = await this.checkCache('region', regionID);
        if (
            regionCache &&
            regionCache.date.getTime() > this.cacheExpireDate.getTime()
        ) {
            return regionCache;
        } else {
            let regionJSON = await this.fetchJSON(
                `universe/regions/${regionID}`
            );
            regionJSON.date = new Date();
            let regionStore = this.db
                .transaction('region', 'readwrite')
                .objectStore('region');
            regionStore.put(regionJSON);
            return regionJSON;
        }
    }
    async systemData(systemID: number): Promise<ESI.System> {
        // Consider adding casts for checkCache calls
        let systemCache = await this.checkCache('system', systemID);
        if (
            systemCache &&
            systemCache.date.getTime() > this.cacheExpireDate.getTime()
        ) {
            return systemCache;
        } else {
            let systemJSON = await this.fetchJSON(
                `universe/systems/${systemID}`
            );
            let systemStore = this.db
                .transaction('system', 'readwrite')
                .objectStore('system');
            systemJSON.date = new Date();
            systemStore.put(systemJSON);
            return systemJSON;
        }
    }
    async systemGates(systemID: number): Promise<Record<number, ESI.Stargate>> {
        let systemData = await this.systemData(systemID);
        if (systemData.stargates) {
            let stargateData = fromEntries(
                await Promise.all(
                    systemData.stargates.map(async stargateID => [
                        stargateID,
                        await this.universeData('stargate', stargateID)
                    ])
                )
            );
            return stargateData;
        } else {
            return {};
        }
    }
    async systemRadius(systemID: number): Promise<number> {
        const system = await this.systemData(systemID);
        if (
            system.hasOwnProperty('radius') &&
            typeof system.radius == 'number'
        ) {
            return system.radius;
        }
        let asteroid_belt =
            system.planets &&
            system.planets
                .map(({ asteroid_belts }) => asteroid_belts)
                .filter(moons => moons)
                .reduce(
                    (belts, newBelts) => (belts || []).concat(newBelts || []),
                    []
                );
        let moon =
            system.planets && system.planets.map(({ planet_id }) => planet_id);
        let celestialData: { [s: string]: number[] } = {
            ...(asteroid_belt && { asteroid_belt }),
            ...(moon && { moon }),
            ...(system.planets && {
                planet: system.planets.map(({ planet_id }) => planet_id)
            }),
            ...(system.stargates && { stargate: system.stargates }),
            ...(system.stations && { station: system.stations })
        };
        let positionData: ESI.Positioned[] = await Promise.all(
            Object.entries(celestialData)
                .map(([celestialType, celestials]) =>
                    celestials.map((celesitalID: number) =>
                        this.universeData(celestialType, celesitalID)
                    )
                )
                .reduce((bucket, more) => bucket.concat(more), [])
        );
        let distances = positionData.map(
            ({ position: { x, y, z } }) =>
                Math.sqrt(x * x + y * y + z * z) / 149597870700
        );
        let maxDistance = Math.max(...distances);
        let systemStore = this.db
            .transaction('system', 'readwrite')
            .objectStore('system');
        system.radius = maxDistance;
        systemStore.put(system);
        return maxDistance;
    }
    async routeData(
        originID: number,
        destinationID: number,
        flag: 'shortest' | 'secure' | 'insecure' = 'secure',
        avoid: number[] = []
    ): Promise<number[]> {
        let routeCache = await this.checkCache('route', [
            originID,
            destinationID,
            flag,
            avoid
        ]);
        let cacheExpire = new Date();
        cacheExpire.setDate(cacheExpire.getDate() - 7);
        if (routeCache && routeCache.date.getTime() > cacheExpire.getTime()) {
            return routeCache.hops;
        }
        let routeJSON = await this.fetchJSON(
            `route/${originID}/${destinationID}`,
            [['flag', flag], ...avoid.map(systemID => ['avoid', `${systemID}`])]
        );
        let routeStore = this.db
            .transaction('route', 'readwrite')
            .objectStore('route');
        routeStore.put({
            originID,
            destinationID,
            flag,
            avoidIDs: avoid,
            hops: routeJSON,
            date: new Date()
        });
        return routeJSON;
    }
    async search(search: string, categories = 'solar_system') {
        return await this.fetchJSON(`search`, [
            ['search', search],
            ['categories', categories]
        ]);
    }
    async nearestTradeHub(
        systemID: number,
        flag: 'shortest' | 'secure' | 'insecure' = 'secure',
        avoid: number[] = []
    ): Promise<[number, number]> {
        const tradeHubs = [30000142, 30002510, 30002187, 30002659, 30002053];
        const jumps = await Promise.all(
            tradeHubs.map(hubID => this.routeData(systemID, hubID, flag, avoid))
        );
        let hubJumps = tradeHubs.map((hubID, idx) => [
            hubID,
            jumps[idx].length
        ]);
        hubJumps.sort((a, b) => a[1] - b[1]);
        return [hubJumps[0][0], hubJumps[0][1]];
    }
    loadHistory(): Promise<ESI.IncursionHistory> {
        return new Promise((resolve, reject) => {
            fetch('https://dalingk.com/incursion/api/')
                .then(request => request.json())
                .then(data => resolve(data))
                .catch(err => reject(err));
        });
    }
    async history(constellationID: number): Promise<ESI.HistoryItem> {
        let data = await this.historyData;
        return data[constellationID];
    }
    initSov(): Promise<boolean> {
        let expireDate = new Date();
        let sovCache = this.db
            .transaction('sovereignty')
            .objectStore('sovereignty')
            .openCursor();
        return new Promise((resolve, reject) => {
            sovCache.onsuccess = async e => {
                if (
                    sovCache.result &&
                    sovCache.result.value &&
                    sovCache.result.value.expires.getTime() >
                        expireDate.getTime()
                ) {
                    resolve(true);
                } else {
                    expireDate.setHours(expireDate.getHours() + 1);
                    let sov = this.fetchJSON('sovereignty/map').then(data => {
                        let sovStore = this.db
                            .transaction('sovereignty', 'readwrite')
                            .objectStore('sovereignty');
                        data.forEach((system: ESI.Sovereignty) =>
                            sovStore.put({ ...system, expires: expireDate })
                        );
                    });
                }
                resolve(true);
            };
            sovCache.onerror = e => {
                reject(e);
            };
        });
    }
    async systemSovereignty(systemID: number): Promise<ESI.Sovereignty> {
        await this.sovUpdate;
        let sovCache = await this.checkCache('sovereignty', systemID);
        return sovCache;
    }
    async faction(factionID: number): Promise<ESI.Faction> {
        let expireDate = new Date();
        let factionCache = await this.checkCache('faction', factionID);
        if (
            factionCache &&
            factionCache.expire.getTime() > expireDate.getTime()
        ) {
            return factionCache;
        }
        expireDate.setDate(expireDate.getDate() + 1);
        expireDate.setHours(11, 5);
        let factionJSON = <ESI.Faction[]>(
            await this.fetchJSON('universe/factions')
        );
        let factionStore = this.db
            .transaction('faction', 'readwrite')
            .objectStore('faction');
        let faction = { name: 'Unknown', faction_id: 0 };
        factionJSON.forEach(item => {
            if (item.faction_id == factionID) {
                faction = item;
            }
            factionStore.put({
                faction_id: item.faction_id,
                name: item.name,
                expire: expireDate
            });
        });
        return faction;
    }
    async alliance(allianceID: number): Promise<ESI.Alliance> {
        let expireDate = new Date();
        let allianceCache = await this.checkCache('alliance', allianceID);
        if (
            allianceCache &&
            allianceCache.expire.getTime() > expireDate.getTime()
        ) {
            return allianceCache;
        }
        let alliance = await this.fetchJSON(`alliances/${allianceID}`);
        expireDate.setHours(expireDate.getHours() + 1);
        let allianceStore = this.db
            .transaction('alliance', 'readwrite')
            .objectStore('alliance');
        allianceStore.put({
            alliance_id: allianceID,
            ticker: alliance.ticker,
            name: alliance.name,
            expire: expireDate
        });
        return alliance;
    }
    private async universeData(
        type: string,
        id: number
    ): Promise<ESI.Positioned> {
        let cachedData = await this.checkCache(type, id);
        if (
            cachedData &&
            cachedData.date.getTime() > this.cacheExpireDate.getTime()
        ) {
            return cachedData;
        } else {
            let universeJSON = await this.fetchJSON(`universe/${type}s/${id}`);
            universeJSON.date = new Date();
            if (type == 'asteroid_belt') {
                universeJSON.asteroidBeltID = id;
            }
            let store = this.db
                .transaction(type, 'readwrite')
                .objectStore(type);
            store.put(universeJSON);
            return universeJSON;
        }
    }
}

class IncursionDisplay {
    private data: ESIData;
    constructor(data: ESIData) {
        this.data = data;
    }
    constellation(constellationID: number) {
        const constellationElement = document.createElement('a');
        const constellationName = document.createTextNode(`${constellationID}`);
        constellationElement.appendChild(constellationName);
        this.data.constellationData(constellationID).then(constellation => {
            constellationName.nodeValue = `${constellation.name}`;
            this.data
                .regionData(constellation.region_id)
                .then(
                    ({ name }) =>
                        (constellationElement.href = `https://evemaps.dotlan.net/map/${name.replace(
                            ' ',
                            '_'
                        )}/${constellation.name}`)
                );
        });
        return constellationElement;
    }
    state(constellationID: number, state: string) {
        const display = document.createElement('div');
        const current = document.createElement('div');
        current.appendChild(new Text('State: '));
        display.appendChild(current);
        const link = document.createElement('a');
        link.href = '#';
        let visible = false;
        const history = document.createElement('table');
        history.classList.add('events');
        const historyBody = document.createElement('tbody');
        history.style.display = visible ? 'block' : 'none';
        history.style.listStyleType = 'none';
        history.style.paddingLeft = '0';
        link.addEventListener('click', e => {
            e.preventDefault();
            visible = !visible;
            history.style.display = visible ? 'block' : 'none';
        });
        history.appendChild(historyBody);
        this.data.history(constellationID).then(data => {
            let sortedHistory = Object.entries(data.history);
            sortedHistory.sort((a, b) => ('' + b[1]).localeCompare(a[1]));
            let sortedMap = sortedHistory.reduce(
                (allDates: Map<string, [string, Date][]>, [state, date]) => {
                    let currentDate = new Date(date + 'Z');
                    let key = `${currentDate.getFullYear()}-${(
                        '' +
                        (currentDate.getMonth() + 1)
                    ).padStart(2, '0')}-${(
                        '' + currentDate.getUTCDate()
                    ).padStart(2, '0')}`;
                    let dateArray = allDates.get(key);
                    if (!dateArray) {
                        let temp: [string, Date][] = [];
                        allDates.set(key, temp);
                        dateArray = temp;
                    }
                    dateArray.push([state, currentDate]);
                    return allDates;
                },
                new Map()
            );
            let iterator = sortedMap.entries();
            let value = iterator.next().value;
            while (value) {
                let [date, events] = value;
                const dateDisplay = document.createDocumentFragment();
                events.map(([state, eventDate], idx) => {
                    const row = document.createElement('tr');
                    if (idx === 0) {
                        const shortDate = document.createElement('td');
                        shortDate.appendChild(new Text(`${date}`));
                        shortDate.rowSpan = events.length;
                        shortDate.style.verticalAlign = 'top';
                        row.appendChild(shortDate);
                    }
                    const time = document.createElement('td');
                    time.classList.add('pad');
                    time.appendChild(
                        new Text(
                            `${('' + eventDate.getUTCHours()).padStart(
                                2,
                                '0'
                            )}:${('' + eventDate.getMinutes()).padStart(
                                2,
                                '0'
                            )}`
                        )
                    );
                    const stateElement = document.createElement('td');
                    stateElement.appendChild(
                        new Text(state.charAt(0).toUpperCase() + state.slice(1))
                    );
                    row.appendChild(time);
                    row.appendChild(stateElement);
                    dateDisplay.appendChild(row);
                });
                historyBody.appendChild(dateDisplay);
                value = iterator.next().value;
            }
            display.appendChild(history);
        });
        link.appendChild(
            new Text(state.charAt(0).toUpperCase() + state.slice(1))
        );
        current.appendChild(link);
        return display;
    }
    system(systemID: number) {
        const systemLink = document.createElement('a');
        let systemName = new Text(`${systemID}`);
        this.data.systemData(systemID).then(system => {
            this.data.systemData(systemID).then(system => {
                let temp = new Text(`${system.name}`);
                systemName.replaceWith(temp);
                systemName = temp;
                systemLink.href = `https://evemaps.dotlan.net/system/${
                    system.name
                }`;
            });
        });
        systemLink.appendChild(systemName);
        return systemLink;
    }
    systemSecurity(systemID: number) {
        let security = document.createElement('span');
        let securityValue = new Text('?');
        security.appendChild(securityValue);
        this.data.systemData(systemID).then(({ security_status }) => {
            securityValue.replaceWith(
                new Text(`${security_status.toFixed(1)}`)
            );
            if (security_status < 0) {
                security_status = 0;
            }
            security.style.color =
                securityColors[Math.round(security_status * 10)];
        });
        return security;
    }
    systemRadius(systemID: number) {
        const radiusDisplay = document.createElement('span');
        let radiusText = new Text('? AU');
        radiusDisplay.appendChild(radiusText);
        this.data.systemRadius(systemID).then(radius => {
            const temp = new Text(`${radius.toFixed(1)} AU`);
            radiusText.replaceWith(temp);
            radiusText = temp;
        });
        return radiusDisplay;
    }
    systemRow(systemID: number, staging_solar_system_id: number) {
        const row = document.createElement('tr');
        [this.system, this.systemSecurity, this.systemRadius].forEach(
            column => {
                const td = document.createElement('td');
                td.appendChild(column.apply(this, [systemID]));
                row.appendChild(td);
            }
        );
        return row;
    }
    systemSovereignty(systemID: number) {
        const sovDisplay = document.createElement('div');
        sovDisplay.appendChild(new Text('Sovereignty: '));
        this.data.systemSovereignty(systemID).then(async systemData => {
            if (
                systemData.hasOwnProperty('alliance_id') &&
                systemData.alliance_id
            ) {
                const link = document.createElement('a');
                let { name, ticker } = await this.data.alliance(
                    systemData.alliance_id
                );
                link.href = `https://evemaps.dotlan.net/alliance/${name.replace(
                    ' ',
                    '_'
                )}`;
                link.title = ticker;
                link.appendChild(new Text(`${name}`));
                sovDisplay.appendChild(link);
            } else if (
                systemData.hasOwnProperty('faction_id') &&
                systemData.faction_id
            ) {
                let { name } = await this.data.faction(systemData.faction_id);
                sovDisplay.appendChild(new Text(`${name}`));
            }
        });
        return sovDisplay;
    }
    superCarrierIcon() {
        const icon = document.createElement('canvas');
        icon.title = 'Boss spawned';
        icon.width = 32;
        icon.height = 32;
        const ctx = icon.getContext('2d');
        if (!ctx) {
            return document.createTextNode('Boss');
        }
        ctx.scale(2, 2);
        ctx.translate(8, 8);
        ctx.rotate((45 * Math.PI) / 180);
        ctx.translate(-8, -8);
        ctx.fillStyle = '#7d0808';
        ctx.fillRect(3, 3, 7, 7);
        ctx.strokeStyle = '#d63333';
        ctx.strokeRect(3, 3, 7, 7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(12, 4);
        ctx.lineTo(12, 12);
        ctx.lineTo(4, 12);
        ctx.stroke();
        return icon;
    }
}

class RoutePlanner {
    esi: ESIData;
    location: HTMLInputElement;
    avoid: HTMLInputElement;
    prefer: HTMLSelectElement;
    error: HTMLElement;
    routeItems: {
        [destinationID: number]: {
            jumpCounter: Text;
            routeList: HTMLOListElement;
            jumpCount: number;
            visible: boolean;
        };
    };
    avoidIDs: number[];
    originID: number;
    renderer: IncursionDisplay;
    initialLoad: Promise<boolean>;
    constructor(
        esi: ESIData,
        elements: {
            location: HTMLInputElement;
            avoid: HTMLInputElement;
            prefer: HTMLSelectElement;
            error: HTMLElement;
        }
    ) {
        this.esi = esi;
        this.location = elements.location;
        this.avoid = elements.avoid;
        this.prefer = elements.prefer;
        this.error = elements.error;
        this.routeItems = {};
        this.originID = 0;
        this.avoidIDs = [];
        this.renderer = new IncursionDisplay(this.esi);
        if (this.location.form) {
            this.location.form.addEventListener('submit', e => {
                e.preventDefault();
                this.updateRoutes();
            });
        }
        this.searchIDs();
        this.initialLoad = new Promise((resolve, reject) => {
            this.searchIDs().then(() => resolve(true));
        });
    }
    async searchIDs() {
        let avoidSystemNames = this.avoid.value
            ? this.avoid.value.split(',')
            : [];
        let [{ solar_system: originResult }, ...avoid] = await Promise.all([
            this.esi.search(this.location.value),
            ...avoidSystemNames.map(systemName => this.esi.search(systemName))
        ]);
        if (!originResult || originResult.length < 1) {
            this.showError(
                `Unable to find solar system "${this.location.value}"`
            );
            return;
        }
        avoid = avoid.map(({ solar_system }) => solar_system);
        let invalidAvoid = avoid.some((item, idx) => {
            if (typeof item === 'undefined') {
                this.showError(
                    `Unable to find solar system "${avoidSystemNames[idx]}".`
                );
                return true;
            }
            return false;
        });
        if (invalidAvoid) {
            return;
        }
        avoid = avoid.reduce(
            (avoidValues, nextID) => avoidValues.concat(nextID),
            []
        );
        window.localStorage.setItem('location', this.location.value);
        window.localStorage.setItem('avoid', this.avoid.value);
        window.localStorage.setItem('prefer', this.prefer.value);
        this.originID = originResult[0];
        this.avoidIDs = avoid;
    }
    async register(destinationID: number, targetElement: HTMLElement) {
        const show = document.createElement('span');
        const link = document.createElement('a');
        const routeList = document.createElement('ol');
        let toggleText = new Text(`Show all`);
        link.href = '#';
        link.appendChild(toggleText);
        show.appendChild(link);
        show.addEventListener('click', e => {
            e.preventDefault();
            let target = this.routeItems[destinationID];
            let newText;
            if (target.visible) {
                target.visible = false;
                newText = new Text(
                    `Show ${
                        target.jumpCount > 0
                            ? ' ' + (target.jumpCount - 1) + ' jumps'
                            : ''
                    }`
                );
                target.routeList.style.display = 'none';
            } else {
                target.visible = true;
                newText = new Text(
                    `Hide ${
                        target.jumpCount > 0
                            ? ' ' + (target.jumpCount - 1) + ' jumps'
                            : ''
                    }`
                );
                target.routeList.style.display = 'block';
            }
            target.jumpCounter.replaceWith(newText);
            target.jumpCounter = newText;
        });
        targetElement.appendChild(show);

        targetElement.appendChild(routeList);

        this.routeItems[destinationID] = {
            jumpCount: 0,
            jumpCounter: toggleText,
            routeList,
            visible: false
        };
        await this.updateSingleRoute([
            destinationID,
            this.routeItems[destinationID]
        ]);
    }
    async updateSingleRoute(
        routeEntry: [
            number,
            {
                jumpCount: number;
                jumpCounter: Text;
                routeList: HTMLOListElement;
                visible: boolean;
            }
        ]
    ) {
        await this.initialLoad;
        let [systemID, targetElement] = routeEntry;
        let hops = await this.esi.routeData(
            this.originID,
            systemID,
            'secure',
            this.avoidIDs
        );
        const routeList = document.createElement('ol');
        const routeCount = new Text(`Show ${hops.length - 1} jumps`);
        routeList.style.display = 'none';
        hops.map(systemID => {
            const item = document.createElement('li');
            item.appendChild(this.renderer.system(systemID));
            item.appendChild(new Text(' ('));
            item.appendChild(this.renderer.systemSecurity(systemID));
            item.appendChild(new Text(')'));
            routeList.appendChild(item);
        });
        targetElement.jumpCounter.replaceWith(routeCount);
        targetElement.jumpCounter = routeCount;
        targetElement.routeList.replaceWith(routeList);
        targetElement.routeList = routeList;
        targetElement.jumpCount = hops.length;
        targetElement.visible = false;
    }
    async updateRoutes() {
        this.clearError();
        await this.searchIDs();
        await Promise.all(
            Object.entries(this.routeItems).map(([systemID, targetElement]) =>
                this.updateSingleRoute([parseInt(systemID), targetElement])
            )
        );
    }
    tradeHub(systemID: number) {
        const target = document.createElement('div');
        target.appendChild(new Text('Trade hub: '));
        this.esi
            .nearestTradeHub(systemID, 'secure', this.avoidIDs)
            .then(([hubID, jumps]) => {
                target.appendChild(this.renderer.system(hubID));
                target.appendChild(new Text(' ('));
                target.appendChild(this.renderer.systemSecurity(hubID));
                target.appendChild(new Text(`) ${jumps - 1}j`));
                target.normalize();
            });
        return target;
    }
    showError(message: string) {
        const newError = document.createElement('div');
        newError.id = 'routeError';
        newError.classList.add('error');
        newError.appendChild(new Text(message));
        this.error.replaceWith(newError);
        this.error = newError;
    }
    clearError() {
        const newError = document.createElement('div');
        newError.id = 'routeError';
        newError.classList.add('error');
        this.error.replaceWith(newError);
        this.error = newError;
    }
}

function main() {
    let location = <HTMLInputElement>document.getElementById('location');
    let avoid = <HTMLInputElement>document.getElementById('avoid');
    let prefer = <HTMLSelectElement>document.getElementById('prefer');
    let error = <HTMLElement>document.getElementById('routeError');
    location.value = window.localStorage.getItem('location') || 'Jita';
    avoid.value = window.localStorage.getItem('avoid') || '';
    prefer.value = window.localStorage.getItem('prefer') || 'secure';
    let openDatabase = window.indexedDB.open('incursion');
    openDatabase.onerror = event => {
        document.body.appendChild(
            document.createTextNode('Failed to connect to cache database.')
        );
    };
    openDatabase.onsuccess = async event => {
        let esiAPI = new ESIData(openDatabase.result);
        let routePlanner = new RoutePlanner(esiAPI, {
            location,
            avoid,
            prefer,
            error
        });

        let incursions = document.createElement('main');
        let renderer = new IncursionDisplay(esiAPI);
        let incursionData = await esiAPI.incursionData();
        let sortIncursions: Function[] = [];
        incursionData.forEach(async incursion => {
            let display = document.createElement('section');

            let constellationName = document.createElement('h1');
            constellationName.appendChild(
                renderer.constellation(incursion.constellation_id)
            );
            if (incursion.has_boss) {
                constellationName.appendChild(renderer.superCarrierIcon());
            }
            display.appendChild(constellationName);

            const state = document.createElement('div');
            state.appendChild(
                renderer.state(incursion.constellation_id, incursion.state)
            );
            display.appendChild(state);

            let influence = document.createElement('div');
            influence.appendChild(
                document.createTextNode(
                    `Influence: ${((1 - incursion.influence) * 100).toFixed(
                        1
                    )}% effective`
                )
            );
            display.appendChild(influence);

            display.appendChild(document.createElement('br'));

            let tradeHub = document.createElement('div');
            tradeHub.appendChild(new Text('Trade hub: '));
            display.appendChild(tradeHub);

            let hqSovereignty = document.createElement('div');
            hqSovereignty.appendChild(new Text('Sovereignty: '));
            display.appendChild(hqSovereignty);

            display.appendChild(document.createElement('br'));

            let staging = document.createElement('div');
            staging.appendChild(document.createTextNode('Staging system: '));
            staging.appendChild(
                renderer.system(incursion.staging_solar_system_id)
            );
            staging.appendChild(new Text(' ('));
            staging.appendChild(
                renderer.systemSecurity(incursion.staging_solar_system_id)
            );
            staging.appendChild(new Text(')'));
            display.appendChild(staging);

            let sortSystems: Function[] = [];
            let affectedSystems = document.createElement('table');
            affectedSystems.classList.add('systems');
            let affectedSystemsBody = document.createElement('tbody');
            incursion.infested_solar_systems.forEach(systemID => {
                const row = renderer.systemRow(
                    systemID,
                    incursion.staging_solar_system_id
                );
                const jumpCount = document.createElement('td');
                row.appendChild(jumpCount);
                affectedSystemsBody.appendChild(row);
                sortSystems.push(async () => {
                    let [systemData, gates] = await Promise.all([
                        esiAPI.systemData(systemID),
                        esiAPI.systemGates(systemID)
                    ]);
                    return [systemID, { row, jumpCount, systemData, gates }];
                });
            });
            affectedSystems.appendChild(affectedSystemsBody);
            display.appendChild(affectedSystems);

            let route = document.createElement('div');
            route.appendChild(new Text('Route: '));
            display.appendChild(route);

            Promise.all(sortSystems.map(fn => fn())).then(systemArray => {
                let gates = systemArray.reduce(
                    (allGates, systemData) => ({
                        ...allGates,
                        ...systemData[1].gates
                    }),
                    {}
                );
                let systems = fromEntries(systemArray);
                let unvisitedSystems = [incursion.staging_solar_system_id];
                let visitedSystems = new Set();
                let jumps = 0;
                let furthest = incursion.staging_solar_system_id;
                let arrangeSystems: [number, number, HTMLElement][] = [];
                while (unvisitedSystems.length > 0) {
                    let newUnvisited: number[] = [];
                    unvisitedSystems.forEach(systemID => {
                        if (!visitedSystems.has(systemID)) {
                            visitedSystems.add(systemID);
                            if (jumps > 0) {
                                systems[systemID].jumpCount.appendChild(
                                    new Text(`${jumps}`)
                                );
                            }
                            newUnvisited = [
                                ...newUnvisited,
                                ...systems[systemID].systemData.stargates
                                    .map(
                                        (gateID: number) =>
                                            gates[gateID].destination.system_id
                                    )
                                    .filter((systemID: number) =>
                                        systems.hasOwnProperty(systemID)
                                    )
                            ];
                            furthest = systemID;
                            arrangeSystems.push([
                                jumps,
                                systemID,
                                systems[systemID].row
                            ]);
                        }
                    });
                    unvisitedSystems = newUnvisited;
                    jumps += 1;
                }
                arrangeSystems.sort((a, b) => a[0] - b[0]);
                let newBody = document.createElement('tbody');
                arrangeSystems.forEach(([, , element]) =>
                    newBody.appendChild(element)
                );
                affectedSystemsBody.replaceWith(newBody);
                tradeHub.replaceWith(routePlanner.tradeHub(furthest));
                hqSovereignty.replaceWith(renderer.systemSovereignty(furthest));
                routePlanner.register(furthest, route);
            });

            sortIncursions.push(async () => [
                display,
                await esiAPI.systemData(incursion.staging_solar_system_id)
            ]);

            incursions.appendChild(display);
        });
        document.body.appendChild(incursions);
        let incursionSecurities = await Promise.all(
            sortIncursions.map(fn => fn())
        );
        incursionSecurities.sort(
            (a, b) => b[1].security_status - a[1].security_status
        );
        const sortedIncursions = document.createElement('main');
        const lastUpdated = document.createElement('div');
        lastUpdated.style.marginTop = '1em';
        lastUpdated.style.textAlign = 'center';
        let updatedDate = new Date();
        lastUpdated.appendChild(
            new Text(
                `Last Updated: ${('' + updatedDate.getUTCHours()).padStart(
                    2,
                    '0'
                )}:${('' + updatedDate.getMinutes()).padStart(2, '0')}`
            )
        );
        sortedIncursions.appendChild(lastUpdated);
        incursionSecurities.forEach(([element]) =>
            sortedIncursions.appendChild(element)
        );
        incursions.replaceWith(sortedIncursions);
    };
    openDatabase.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        let db = openDatabase.result;

        Array.from(db.objectStoreNames).map(storeName =>
            db.deleteObjectStore(storeName)
        );

        let constellationStore = db.createObjectStore('constellation', {
            keyPath: 'constellation_id'
        });
        constellationStore.createIndex('constellation_id', 'constellation_id', {
            unique: true
        });

        let regionStore = db.createObjectStore('region', {
            keyPath: 'region_id'
        });
        regionStore.createIndex('region_id', 'region_id', { unique: true });

        let systemStore = db.createObjectStore('system', {
            keyPath: 'system_id'
        });
        systemStore.createIndex('system_id', 'system_id', { unique: true });

        let asteroidBeltStore = db.createObjectStore('asteroid_belt', {
            keyPath: 'asteroidBeltID'
        });
        asteroidBeltStore.createIndex('asteroidBeltID', 'asteroidBeltID', {
            unique: true
        });

        let moonStore = db.createObjectStore('moon', { keyPath: 'moon_id' });
        moonStore.createIndex('moon_id', 'moon_id', { unique: true });

        let planetStore = db.createObjectStore('planet', {
            keyPath: 'planet_id'
        });
        planetStore.createIndex('planet_id', 'planet_id');

        let stargateStore = db.createObjectStore('stargate', {
            keyPath: 'stargate_id'
        });
        stargateStore.createIndex('stargate_id', 'stargate_id');

        let stationStore = db.createObjectStore('station', {
            keyPath: 'station_id'
        });
        stationStore.createIndex('station_id', 'station_id');

        let routeStore = db.createObjectStore('route', {
            keyPath: ['originID', 'destinationID', 'flag', 'avoidIDs']
        });

        let sovereigntyStore = db.createObjectStore('sovereignty', {
            keyPath: 'system_id'
        });
        let allianceStore = db.createObjectStore('alliance', {
            keyPath: 'alliance_id'
        });
        let factionStore = db.createObjectStore('faction', {
            keyPath: 'faction_id'
        });
    };
}
(function() {
    let mainRan = false;
    if (document.readyState != 'loading') {
        mainRan && main();
        mainRan = true;
    } else {
        document.addEventListener('readystatechange', () => {
            if (document.readyState != 'loading') {
                mainRan && main();
                mainRan = true;
            }
        });
    }
})();
