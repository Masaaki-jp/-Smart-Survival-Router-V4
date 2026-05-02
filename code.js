/**
 * Smart Survival Router V4 (Haversine Formula Edition)
 * 気象ハザードに基づき、ハバーシンの公式による距離計算から交通手段と時間を動的に選択する
 */

// ==========================================
// 1. 設定部分
// ==========================================
const HOME_ADDRESS = 'Enter_Your_Address';
const BUFFER_MINUTES = 5; // 到着余裕時間
const WEATHER_CALENDAR_ID = 'YOUR_CALENDAR_ID@group.calendar.google.com';
const DAYS_TO_CHECK = 30; // 30日先まで計算

// ハザード検知用キーワード
const HAZARD_MAP = {
  SEVERE_HEAT: 'SEVERE HEAT', // 酷暑（40℃〜）
  EXTREME_HEAT: 'Extreme Heat', // 猛暑（35℃〜）
  STRONG_WIND: 'Windy',        // 強風
  RAIN: 'Rain',                // 雨（OpenWeather）
  YAHOO_RAIN: '[Yahoo] 降雨',   // 雨（Yahoo!）
  CHILLY: 'Chilly'             // 寒冷
};

// 移動速度の設定（km/h）と迂回係数
const SPEED_WALK = 4.8;  // 徒歩：時速約4.8km
const SPEED_BIKE = 15.0; // 自転車：時速約15km
const SPEED_CAR = 30.0;  // 自動車：時速約30km（市街地）
const DETOUR_RATE = 1.4; // 直線距離を実際の道程に近づけるための迂回係数

// ==========================================
// 2. メイン処理
// ==========================================
function automateHazardAwareTravelSchedule() {
  const calendar = CalendarApp.getDefaultCalendar();
  const now = new Date();
  const endDate = new Date();
  endDate.setDate(now.getDate() + DAYS_TO_CHECK);
  
  const events = calendar.getEvents(now, endDate);
  
  // 対象の予定を抽出
  const taskEvents = events.filter(e => 
    e.getLocation() !== '' && 
    !e.getTitle().match(/^(移動：|帰宅：|\[.*?\])/) && 
    !e.isAllDayEvent()
  );

  if (taskEvents.length === 0) return;

  const eventsByDate = {};
  taskEvents.forEach(e => {
    const d = e.getStartTime();
    const dateKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push(e);
  });

  for (const dateKey in eventsByDate) {
    console.log(`--- ${dateKey} ハザード分析＆距離計算開始 ---`);
    let currentOrigin = HOME_ADDRESS; 
    let lastEventEndTime = null; 
    let lastEventTitle = "";
    
    const dailyEvents = eventsByDate[dateKey].sort((a, b) => a.getStartTime() - b.getStartTime());

    dailyEvents.forEach((event) => {
      const destination = event.getLocation();
      const eventStartTime = event.getStartTime();

      // オンラインなどの予定は除外
      if (destination.match(/zoom|オンライン|online|meet|teams/i)) {
        console.log(`[スキップ] "${event.getTitle()}" はオンライン予定のため経路計算を除外します。`);
        lastEventEndTime = event.getEndTime();
        lastEventTitle = event.getTitle();
        return; 
      }

      if (currentOrigin === destination) {
        lastEventEndTime = event.getEndTime();
        lastEventTitle = event.getTitle();
        return;
      }

      const hazards = getActiveHazards(eventStartTime);
      const routeData = getEstimatedRoute(currentOrigin, destination, hazards);

      if (routeData) {
        const travelTimeMinutes = routeData.minutes;
        const travelEndTime = new Date(eventStartTime.getTime() - (BUFFER_MINUTES * 60 * 1000));
        const travelStartTime = new Date(travelEndTime.getTime() - (travelTimeMinutes * 60 * 1000));

        createTravelEvent(calendar, event.getTitle(), travelStartTime, travelEndTime, currentOrigin, destination, routeData, travelTimeMinutes, BUFFER_MINUTES, true);
      } else {
        console.log(`[警告] "${event.getTitle()}" への位置情報が取得できなかったため予定作成をスキップしました。`);
      }

      currentOrigin = destination;
      lastEventEndTime = event.getEndTime();
      lastEventTitle = event.getTitle();
    });

    // 帰宅計算
    if (currentOrigin !== HOME_ADDRESS && lastEventEndTime) {
      const hazards = getActiveHazards(lastEventEndTime);
      const routeData = getEstimatedRoute(currentOrigin, HOME_ADDRESS, hazards);
      
      if (routeData) {
        const returnStartTime = new Date(lastEventEndTime.getTime());
        const returnEndTime = new Date(returnStartTime.getTime() + (routeData.minutes * 60 * 1000));
        createTravelEvent(calendar, `${lastEventTitle} から`, returnStartTime, returnEndTime, currentOrigin, "自宅", routeData, routeData.minutes, 0, false);
      } else {
        console.log(`[警告] 自宅への帰宅位置情報が取得できませんでした。`);
      }
    }
  }
}

// ==========================================
// 3. ルーティング・ロジック（ハバーシン距離とハザード分岐）
// ==========================================

function getEstimatedRoute(origin, destination, hazards) {
  const coordOrigin = getCoordinates(origin);
  const coordDest = getCoordinates(destination);

  if (!coordOrigin || !coordDest) {
    return null;
  }

  // ハバーシンの公式による直線距離(km)
  const straightDistance = getHaversineDistance(coordOrigin.lat, coordOrigin.lng, coordDest.lat, coordDest.lng);
  
  // 実際の道のりを考慮した実質距離(km)
  const actualDistance = straightDistance * DETOUR_RATE;

  // 各移動手段の所要時間（分）を計算
  const walkMin = Math.ceil((actualDistance / SPEED_WALK) * 60);
  const bikeMin = Math.ceil((actualDistance / SPEED_BIKE) * 60);
  const carMin = Math.ceil((actualDistance / SPEED_CAR) * 60);
  // 公共交通機関は、車の移動時間に駅・バス停の徒歩や待ち時間を一律で10分プラスして概算
  const transitMin = carMin + 10; 

  let selectedMode = '';
  let finalMinutes = 0;
  let hazardNote = '';

  // 1. 最優先：命の危険（酷暑 / 猛暑）
  if (hazards.isSevereHeat || hazards.isExtremeHeat) {
    selectedMode = '[Car]'; 
    finalMinutes = carMin;
    hazardNote = '猛暑・酷暑警戒';
  }
  // 2. 強風（Windy）
  else if (hazards.isStrongWind) {
    selectedMode = '[Train/Bus]'; // 自転車避け
    finalMinutes = transitMin;
    hazardNote = '強風注意';
  }
  // 3. 雨（Rain / Yahoo）
  else if (hazards.isRainy) {
    if (walkMin <= 15) {
      selectedMode = '[Train/Bus]';
      finalMinutes = transitMin;
    } else {
      selectedMode = '[Car]';
      finalMinutes = carMin;
    }
    hazardNote = '雨天';
  }
  // 4. 通常時（晴れなど）
  else {
    if (walkMin <= 15) {
      selectedMode = '[Walk]';
      finalMinutes = walkMin;
    } else if (bikeMin <= 30) {
      selectedMode = '[Bicycle]';
      finalMinutes = bikeMin;
    } else {
      selectedMode = '[Train/Bus]';
      finalMinutes = transitMin;
    }
  }

  // 距離が近すぎる場合のケア（最低1分）
  if (finalMinutes < 1) finalMinutes = 1;

  if (selectedMode !== '') {
    console.log(`[ルート決定] ${origin} -> ${destination} | 手段: ${selectedMode} | 推定距離: 約${actualDistance.toFixed(2)}km | 所要時間: ${finalMinutes}分`);
  }

  return { 
    mode: selectedMode, 
    minutes: finalMinutes, 
    hazardNote: hazardNote,
    distanceKm: actualDistance.toFixed(2)
  };
}

// ==========================================
// 4. 補助関数群
// ==========================================

function getActiveHazards(targetTime) {
  const weatherCal = CalendarApp.getCalendarById(WEATHER_CALENDAR_ID);
  const startTime = new Date(targetTime.getTime() - 30 * 60 * 1000);
  const endTime = new Date(targetTime.getTime() + 30 * 60 * 1000);
  const events = weatherCal.getEvents(startTime, endTime);
  
  const h = { isSevereHeat: false, isExtremeHeat: false, isStrongWind: false, isRainy: false, isCold: false };

  events.forEach(e => {
    const title = e.getTitle();
    if (title.includes(HAZARD_MAP.SEVERE_HEAT)) h.isSevereHeat = true;
    if (title.includes(HAZARD_MAP.EXTREME_HEAT)) h.isExtremeHeat = true;
    if (title.includes(HAZARD_MAP.STRONG_WIND)) h.isStrongWind = true;
    if (title.includes(HAZARD_MAP.RAIN) || title.includes(HAZARD_MAP.YAHOO_RAIN)) h.isRainy = true;
    if (title.includes(HAZARD_MAP.CHILLY)) h.isCold = true;
  });

  return h;
}

/**
 * 住所から緯度経度を取得（API制限回避のためのキャッシュ機能付き）
 */
function getCoordinates(address) {
  const props = PropertiesService.getScriptProperties();
  // プロパティ保存用に文字数を丸めるなどしてキーを生成
  const cacheKey = 'GEO_' + Utilities.base64Encode(address).substring(0, 50);
  
  const cached = props.getProperty(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const geocoder = Maps.newGeocoder().setLanguage('ja');
    const response = geocoder.geocode(address);
    if (response.status === 'OK' && response.results.length > 0) {
      const loc = response.results[0].geometry.location;
      // 取得した緯度経度を永続保存（次回以降はAPIを叩かない）
      props.setProperty(cacheKey, JSON.stringify(loc));
      return loc;
    } else {
      console.warn(`[Geocode失敗] 住所: ${address} (ステータス: ${response.status})`);
    }
  } catch(e) {
    console.error(`[Geocodeエラー] ${address}: ${e.message}`);
  }
  return null;
}

/**
 * ハバーシンの公式 (Haversine formula) による2点間の直線距離計算
 */
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球の半径 (km)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
            
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // km
}

function createTravelEvent(calendar, baseTitle, startTime, endTime, origin, destination, routeData, minutes, buffer, isGo) {
  const prefix = isGo ? '移動：' : '帰宅：';
  const newTitle = `${routeData.mode} ${prefix}${baseTitle}`;
  const searchKeyword = `${prefix}${baseTitle}`;

  const searchStart = new Date(startTime.getTime() - (2 * 60 * 60 * 1000));
  const searchEnd = new Date(endTime.getTime() + (2 * 60 * 60 * 1000));
  const existingEvents = calendar.getEvents(searchStart, searchEnd);

  for (const ev of existingEvents) {
    if (ev.getTitle().includes(searchKeyword)) {
      if (ev.getTitle() === newTitle && ev.getStartTime().getTime() === startTime.getTime()) {
        return; 
      } else {
        ev.deleteEvent();
      }
    }
  }

  const desc = `所要時間：約${minutes}分（概算距離 約${routeData.distanceKm}km）\n手段：${routeData.mode}\n${routeData.hazardNote ? '警告：' + routeData.hazardNote + '\n' : ''}出発：${origin}\n到着：${destination}`;
  const ev = calendar.createEvent(newTitle, startTime, endTime, { location: `${origin} → ${destination}`, description: desc });

  if (routeData.mode === '[Walk]') ev.setColor(CalendarApp.EventColor.YELLOW);
  else if (routeData.mode === '[Bicycle]') ev.setColor(CalendarApp.EventColor.GREEN);
  else if (routeData.mode === '[Train/Bus]') ev.setColor(CalendarApp.EventColor.BLUE);
  else if (routeData.mode === '[Car]') ev.setColor(CalendarApp.EventColor.RED);
}
