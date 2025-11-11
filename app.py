from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from datetime import datetime
import requests
import io
from PIL import Image
from pathlib import Path
from PIL.ExifTags import TAGS, GPSTAGS
import os
from dotenv import load_dotenv
from math import radians, sin, cos, sqrt, atan2

# -----------------------------------
# 환경 변수 로드 (로컬 개발용으로 유지)
# Render에서는 대시보드 환경 변수가 우선 적용됨
# -----------------------------------
BASE_DIR = Path(__file__).resolve().parent  # project 폴더
# Render에 배포할 때는 .env 파일을 사용하지 않으므로, 이 라인은 로컬 테스트용으로만 작동
# Render 대시보드에 YOUR_KEY, KAKAO_REST_API_KEY, DEEPL_API_KEY를 설정해야 합니다.
# load_dotenv(BASE_DIR / ".env") # 이 라인은 Render에서는 불필요하며, 실수 방지를 위해 주석 처리하거나 삭제 가능

app = Flask(
    __name__, 
    template_folder=str(BASE_DIR), 
    static_folder=str(BASE_DIR / "static") 
)
CORS(app)

# .env 또는 Render 환경 변수에서 API 키 불러오기
YOUR_KEY = os.getenv("YOUR_KEY")
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY")
DEEPL_API_KEY = os.getenv("DEEPL_API_KEY")

LANDMARK_CATEGORIES = ["MT1", "SW8", "PO3", "SC4"]

# -----------------------------------
# (나머지 함수들은 동일합니다: is_date_in_range, fetch_cultural_events, 
# get_decimal_from_dms, get_gps_from_image, get_photo_taken_date, 
# search_place_name_nearby, reverse_geocode, generate_photo_summary, 
# haversine, translate_text_deepl)
# -----------------------------------

def is_date_in_range(date_str, target_date_str):
    parts = [p.strip() for p in date_str.split('~')]
    fmt = "%Y-%m-%d"
    try:
        target_date = datetime.strptime(target_date_str, fmt)
        if len(parts) == 1:
            event_date = datetime.strptime(parts[0], fmt)
            return event_date == target_date
        elif len(parts) == 2:
            start_date = datetime.strptime(parts[0], fmt)
            end_date = datetime.strptime(parts[1], fmt)
            return start_date <= target_date <= end_date
    except ValueError:
        pass
    return False

def fetch_cultural_events(api_key: str, start: int = 1, end: int = 900):
    url = f"http://openapi.seoul.go.kr:8088/{api_key}/json/culturalEventInfo/{start}/{end}/"
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        return data.get("culturalEventInfo", {}).get("row", [])
    except Exception:
        return []

def get_decimal_from_dms(dms, ref):
    try:
        degrees = dms[0].numerator / dms[0].denominator
        minutes = dms[1].numerator / dms[1].denominator
        seconds = dms[2].numerator / dms[2].denominator
    except Exception:
        return None
    decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
    if ref in ['S', 'W']:
        decimal = -decimal
    return decimal

def get_gps_from_image(image_bytes: bytes):
    try:
        image = Image.open(io.BytesIO(image_bytes))
        exif_data = image._getexif()
        if not exif_data:
            return None
        gps_info = {}
        for tag, value in exif_data.items():
            decoded = TAGS.get(tag, tag)
            if decoded == "GPSInfo":
                for t in value:
                    gps_info[GPSTAGS.get(t, t)] = value[t]
        lat = get_decimal_from_dms(gps_info.get('GPSLatitude'), gps_info.get('GPSLatitudeRef'))
        lon = get_decimal_from_dms(gps_info.get('GPSLongitude'), gps_info.get('GPSLongitudeRef'))
        return (lat, lon) if lat and lon else None
    except Exception:
        return None

def get_photo_taken_date(image_bytes: bytes):
    try:
        image = Image.open(io.BytesIO(image_bytes))
        exif_data = image._getexif()
        if not exif_data:
            return None
        for tag, value in exif_data.items():
            if TAGS.get(tag, tag) == "DateTimeOriginal":
                return value.split(" ")[0].replace(":", "-")
        return None
    except Exception:
        return None

def search_place_name_nearby(lat, lon):
    url = "https://dapi.kakao.com/v2/local/search/category.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    min_distance = float('inf')
    best_place = None

    for code in LANDMARK_CATEGORIES:
        params = {"category_group_code": code, "x": lon, "y": lat, "radius": 500, "sort": "distance", "size": 1}
        try:
            r = requests.get(url, headers=headers, params=params)
            if r.status_code != 200:
                print(f"[카카오 API 응답 오류] 코드: {r.status_code}, 내용: {r.text}")
            data = r.json()
            if data.get("documents"):
                doc = data["documents"][0]
                distance = int(doc.get("distance", 9999))
                if distance < min_distance:
                    min_distance = distance
                    best_place = doc["place_name"]
                if distance <= 50:
                    break
        except Exception:
            continue
    return best_place

def reverse_geocode(lat, lon):
    url = "https://dapi.kakao.com/v2/local/geo/coord2address.json"
    headers = {"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"}
    params = {"x": lon, "y": lat}
    try:
        r = requests.get(url, headers=headers, params=params)
        data = r.json()
        if data.get("documents"):
            doc = data["documents"][0]
            return doc.get("road_address", {}).get("address_name") or doc.get("address", {}).get("address_name", "")
        return ""
    except Exception:
        return ""

def generate_photo_summary(lat, lon):
    place_name = search_place_name_nearby(lat, lon)
    if place_name:
        return f"'{place_name}' 인근에서 촬영된 사진입니다."
    addr = reverse_geocode(lat, lon)
    if addr:
        return f"'{addr}' 인근에서 촬영된 사진입니다."
    return "서울시 일대에서 촬영된 사진입니다."

def haversine(lat1, lon1, lat2, lon2):
    """두 좌표 간 거리 (미터 단위) 계산"""
    R = 6371000  # 지구 반지름 (m)
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return R * c

_translation_cache = {}

def translate_text_deepl(texts, target_lang="EN"):
    if not isinstance(texts, list):
        texts = [texts]

    untranslated = [t for t in texts if t and t not in _translation_cache]
    if not untranslated:
        return [_translation_cache.get(t, t) for t in texts]

    url = "https://api-free.deepl.com/v2/translate"
    headers = {"Authorization": f"DeepL-Auth-Key {DEEPL_API_KEY}"}
    data = {"text": untranslated, "target_lang": target_lang}

    try:
        r = requests.post(url, headers=headers, json=data)
        r.raise_for_status()
        result = r.json()
        translations = result.get("translations", [])
        for orig, tr in zip(untranslated, translations):
            _translation_cache[orig] = tr["text"]
    except Exception as e:
        print(f"[DeepL 오류] {e}")
        for t in untranslated:
            _translation_cache[t] = t

    return [_translation_cache.get(t, t) for t in texts]

# -----------------------------------
# Flask 엔드포인트
# -----------------------------------
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/search_events', methods=['POST'])
def search_events():
    try:
        file = request.files.get('file')
        target_date = request.form.get('target_date')
        if not file or not target_date:
            return jsonify({"error": "파일과 날짜 정보가 필요합니다."}), 400

        image_bytes = file.read()
        gps = get_gps_from_image(image_bytes)
        if not gps:
            return jsonify({"error": "사진에 GPS 정보가 없습니다."}), 400

        lat_image, lon_image = gps

        # 1. 한 줄 요약
        summary_kr = generate_photo_summary(lat_image, lon_image)

        # 2. 행사 데이터
        events = fetch_cultural_events(YOUR_KEY)

        # 3. 위치/날짜 필터링
        rough = []
        for ev in events:
            if ev.get("DATE") and is_date_in_range(ev["DATE"], target_date):
                try:
                    ev_lat = float(ev["LAT"])
                    ev_lon = float(ev["LOT"])
                except:
                    continue
                if abs(ev_lat - lat_image) <= 0.01 and abs(ev_lon - lon_image) <= 0.01:
                    rough.append(ev)

        # 4. 근접 필터링
        filtered = rough
        if len(rough) > 10:
            filtered = [ev for ev in rough if abs(float(ev["LAT"]) - lat_image) <= 0.005 and abs(float(ev["LOT"]) - lon_image) <= 0.005]

        # 5. 거리 계산 후 가까운 순으로 정렬
        for ev in filtered:
            try:
                ev_lat = float(ev["LAT"])
                ev_lon = float(ev["LOT"])
                ev["distance"] = haversine(lat_image, lon_image, ev_lat, ev_lon)
            except Exception:
                ev["distance"] = float('inf')

        filtered.sort(key=lambda x: x["distance"])

        # 6. 번역
        texts_to_translate = [summary_kr]
        for ev in filtered:
            texts_to_translate.append(ev.get("TITLE", ""))
            texts_to_translate.append(ev.get("USE_TRGT", ""))

        translations = translate_text_deepl(texts_to_translate)
        summary_en = translations[0]

        translated_events = []
        tr_idx = 1
        for ev in filtered:
            title_en = translations[tr_idx]; tr_idx += 1
            audience_en = translations[tr_idx]; tr_idx += 1
            translated_events.append({
                "name": title_en,
                "date_range": ev.get("DATE"),
                "audience": audience_en,
                "link": ev.get("HMPG_ADDR"),
                "latitude": ev.get("LAT"),
                "longitude": ev.get("LOT")
            })

        # 7. 결과 반환
        return jsonify({
            "photo_summary": summary_en,
            "location": {"latitude": lat_image, "longitude": lon_image},
            "events": translated_events
        })

    except Exception as e:
        import traceback
        print("[서버 오류]", e)
        print(traceback.format_exc()) # 스택 트레이스를 출력하여 정확한 오류 위치 파악
        return jsonify({"error": "서버 내부 오류가 발생했습니다. 로그를 확인하세요."}), 500


# -----------------------------------
# 실행 (Render 환경 호환)
# -----------------------------------
if __name__ == '__main__':
    # Render 환경에서 PORT 환경 변수를 사용하거나, 없으면 (로컬 실행 시) 3001 포트를 사용
    port = int(os.environ.get("PORT", 3001))
    # host='0.0.0.0'로 설정하여 모든 퍼블릭 IP에서 접근 가능하게 해야 함 (Render 필수)
    # debug=True는 프로덕션 환경에서 권장되지 않으므로 False로 변경
    app.run(host='0.0.0.0', port=port, debug=False)