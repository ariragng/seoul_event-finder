const photoInput = document.getElementById("photoInput");
const dateInput = document.getElementById("dateInput");
const searchButton = document.getElementById("searchButton");
const fileLabel = document.getElementById("fileLabel");

const inputSection = document.getElementById("input-section");
const resultsSection = document.getElementById("results-section");

const resultPhoto = document.getElementById("result-photo");
const displayDate = document.getElementById("displayDate");
const displayLocation = document.getElementById("displayLocation");
const displayDescription = document.getElementById("displayDescription");
const goBackButton = document.getElementById("goBackButton");

// 카카오맵 관련 DOM 요소 및 변수
const mapContainer = document.getElementById('map');
const eventDetailDiv = document.getElementById('event-detail');
const prevEventButton = document.getElementById('prevEventButton');
const nextEventButton = document.getElementById('nextEventButton');
const paginationContainer = document.getElementById('pagination-container');
const paginationButtonsDiv = document.getElementById('pagination-buttons');

// ⭐️ GPS 안내 문구 DOM 요소는 제거되고, Modal 객체로 대체됩니다. ⭐️


let kakaoMap = null;
let eventCurrentIndex = 0;
let uploadedFile = null;
let extractedLocation = 'N/A';
let selectedDate = '';
let eventsData = [];
let photoSummaryText = 'N/A';

// ⭐️ [추가] Bootstrap Modal 객체 생성 및 초기화 ⭐️
let gpsErrorModal = null;
document.addEventListener('DOMContentLoaded', function() {
    if (typeof bootstrap !== 'undefined') {
        // HTML에 추가한 모달 ID를 사용합니다.
        gpsErrorModal = new bootstrap.Modal(document.getElementById('gpsErrorModal'));
    }
});


// -----------------------------------
// Haversine 공식 및 도구 함수
// -----------------------------------
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const φ1 = lat1 * Math.PI / 180; 
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c); 
}

function setMinDate() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    
    const todayString = `${yyyy}-${mm}-${dd}`;
    dateInput.min = todayString;
}

function toDecimal(gpsData) {
    if (gpsData && gpsData.length >= 3) {
        const deg = gpsData[0].numerator / gpsData[0].denominator;
        const min = gpsData[1].numerator / gpsData[1].denominator;
        const sec = gpsData[2].numerator / gpsData[2].denominator;
        return (deg + (min / 60) + (sec / 3600));
    }
    return NaN;
}


// 검색 버튼 활성화 및 GPS 안내
function checkIfSearchReady() {
    // GPS가 'N/A (No GPS Data)' 또는 'Loading GPS...'가 아니어야 Search 버튼 활성화됨
    const isGpsValid = extractedLocation !== 'N/A (No GPS Data)' && extractedLocation !== 'Loading GPS...';
    const isReady = uploadedFile && selectedDate && isGpsValid;
    
    searchButton.disabled = !isReady;
    
    // GPS 안내 문구 (gpsGuideText)가 HTML에서 제거되었으므로, 이 함수 내에서 HTML 변경 코드는 필요 없습니다.
}


function showInputSection() {
    resultsSection.classList.add("d-none");
    inputSection.classList.remove("d-none");
    
    kakaoMap = null;
    eventCurrentIndex = 0;
    uploadedFile = null;
    extractedLocation = 'N/A';
    photoSummaryText = 'N/A';
    fileLabel.textContent = 'Choose File';
    // gpsGuideText.textContent = ''; // 이 줄은 제거합니다.
    photoInput.value = null; 

    checkIfSearchReady();
}

// (중략: initKakaoMapAndDisplayMarkers 부터 updatePaginationButtons 까지 로직은 변경 없음)
function initKakaoMapAndDisplayMarkers(location, events) {
    if (typeof kakao === 'undefined' || typeof kakao.maps === 'undefined') {
        console.error("Kakao Maps API is not loaded.");
        return;
    }
    
    mapContainer.innerHTML = ''; 
    const userLat = location.latitude;
    const userLon = location.longitude;
    const mapOption = {
        center: new kakao.maps.LatLng(userLat, userLon), 
        level: 6,
        scrollwheel: true
    };
    kakaoMap = new kakao.maps.Map(mapContainer, mapOption);
    const bounds = new kakao.maps.LatLngBounds();
    const userPos = new kakao.maps.LatLng(userLat, userLon);
    
    const userMarkerImage = new kakao.maps.MarkerImage(
        'https://i1.daumcdn.net/dmaps/apis/n_local_blit_04.png', 
        new kakao.maps.Size(33, 33), 
        { offset: new kakao.maps.Point(16, 33) }
    );
    new kakao.maps.Marker({
        map: kakaoMap,
        position: userPos,
        title: 'My Photo Location',
        image: userMarkerImage 
    });
    bounds.extend(userPos);

    const eventMarkerImage = new kakao.maps.MarkerImage(
        'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png', 
        new kakao.maps.Size(24, 35), 
        { offset: new kakao.maps.Point(12, 35) }
    );
    events.forEach((ev, index) => {
        const eventPos = new kakao.maps.LatLng(ev.latitude, ev.longitude);
        const eventMarker = new kakao.maps.Marker({
            position: eventPos,
            title: ev.name,
            image: eventMarkerImage 
        });
        eventMarker.setMap(kakaoMap); 
        bounds.extend(eventPos);
        
        kakao.maps.event.addListener(eventMarker, 'click', function() {
            displayEventDetail(index);
        });
    });

    if (events.length > 0) {
        kakaoMap.setBounds(bounds);
    } else {
        kakaoMap.setCenter(userPos);
        kakaoMap.setLevel(7);
    }
    displayEventDetail(0);
}

function displayEventDetail(index) {
    if (eventsData.length === 0) {
        eventDetailDiv.innerHTML = '<p class="mb-0 text-muted">No nearby events found. Try another date.</p>';
        prevEventButton.disabled = true;
        nextEventButton.disabled = true;
        paginationButtonsDiv.innerHTML = ''; 
        paginationContainer.style.display = 'none'; 
        return;
    }
    
    index = (index + eventsData.length) % eventsData.length;
    eventCurrentIndex = index;
    const ev = eventsData[index];
    const userLocationParts = extractedLocation.split(',').map(s => s.trim());
    const userLat = parseFloat(userLocationParts[0]);
    const userLon = parseFloat(userLocationParts[1]);
    
    let distanceString = 'Distance: N/A';
    if (!isNaN(userLat) && !isNaN(userLon) && ev.latitude && ev.longitude) {
        const distanceMeters = getDistance(userLat, userLon, ev.latitude, ev.longitude);
        distanceString = `${(distanceMeters / 1000).toFixed(2)} km (${distanceMeters} m)`;
    }

    eventDetailDiv.innerHTML = `
        <div class="text-start">
            <p class="mb-0 fw-bold">${index + 1}. ${ev.name}</p>
            <p class="mb-0 small"><b>📅 Date:</b> ${ev.date_range}</p> 
            <p class="mb-0 small"><b>📏 Distance:</b> ${distanceString}</p> 
            <p class="mb-0 small"><b>🎯 Target:</b> ${ev.audience}</p>
            <p class="mb-0 small"><b>🔗 Link:</b> <a href="${ev.link}" target="_blank">View Details</a></p>
        </div>
    `;
    
    if (kakaoMap && ev.latitude && ev.longitude) {
        const moveLatLon = new kakao.maps.LatLng(ev.latitude, ev.longitude);
        kakaoMap.panTo(moveLatLon);
    }
    
    prevEventButton.disabled = eventsData.length <= 1;
    nextEventButton.disabled = eventsData.length <= 1;
    updatePaginationButtons(); 
}

prevEventButton.addEventListener('click', () => { displayEventDetail(eventCurrentIndex - 1); });
nextEventButton.addEventListener('click', () => { displayEventDetail(eventCurrentIndex + 1); });
goBackButton.addEventListener("click", showInputSection);
dateInput.addEventListener("change", (e) => {
    selectedDate = e.target.value;
    checkIfSearchReady();
});
searchButton.addEventListener("click", fetchEventsFromBackend);

function setupPaginationButtons() {
    paginationContainer.style.display = eventsData.length > 1 ? 'block' : 'none'; 
    paginationButtonsDiv.innerHTML = '';
    
    if (eventsData.length <= 1) return;
    eventsData.forEach((_, index) => {
        const button = document.createElement('button');
        button.className = 'btn btn-sm btn-outline-secondary';
        button.textContent = index + 1;
        button.addEventListener('click', () => { displayEventDetail(index); });
        paginationButtonsDiv.appendChild(button);
    });
    updatePaginationButtons();
}

function updatePaginationButtons() {
    Array.from(paginationButtonsDiv.children).forEach((button, index) => {
        button.classList.remove('active'); 
        button.classList.add('btn-outline-secondary');
        if (index === eventCurrentIndex) {
            button.classList.add('active');
            button.classList.remove('btn-outline-secondary'); 
        }
    });
}

function showResults(location, events) {
    inputSection.classList.add("d-none");
    resultsSection.classList.remove("d-none");

    const reader = new FileReader();
    reader.onload = e => { resultPhoto.src = e.target.result; };
    reader.readAsDataURL(uploadedFile);

    displayDescription.textContent = photoSummaryText; 
    displayDate.textContent = selectedDate; 
    displayLocation.textContent = extractedLocation;

    initKakaoMapAndDisplayMarkers(location, events);
    setupPaginationButtons();
    
    if (kakaoMap) {
        setTimeout(() => {
            kakaoMap.relayout();
            const centerPos = new kakao.maps.LatLng(location.latitude, location.longitude);
            kakaoMap.setCenter(centerPos);
        }, 50); 
    }
    searchButton.textContent = 'Search';
    searchButton.disabled = false;
}

// -----------------------------------
// ⭐️ [수정된 부분] 백엔드 URL을 상대 경로로 변경 ⭐️
// -----------------------------------
async function fetchEventsFromBackend() {
    const formData = new FormData();
    formData.append('file', uploadedFile);
    formData.append('target_date', selectedDate); 
    
    searchButton.disabled = true;
    searchButton.textContent = 'Searching...';

    try {
        // http://127.0.0.1:3001 대신 상대 경로를 사용하여 Render 배포 환경에 적합하도록 수정
        const res = await fetch('/api/search_events', { 
            method: 'POST', 
            body: formData 
        });
        
        if (!res.ok) {
            const errorData = await res.json();
            // GPS 에러를 포함한 모든 4xx/5xx 에러 처리
            alert('Failed to search events: ' + (errorData.error || 'Server error occurred.'));
            throw new Error('Server returned error status: ' + res.status);
        }
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const location = data.location;
        photoSummaryText = data.photo_summary || '위치 정보를 해석할 수 없습니다.'; 
        extractedLocation = `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;

        eventsData = data.events.map(ev => ({
            name: ev.name,
            date_range: ev.date_range,
            audience: ev.audience || 'N/A', 
            link: ev.link || '#',
            latitude: ev.latitude, 
            longitude: ev.longitude, 
        }));
        showResults(location, eventsData);
    } catch (err) {
        console.error("Backend fetch error:", err);
        showInputSection();
    } finally {
        searchButton.textContent = 'Search';
        checkIfSearchReady();
    }
}

// -----------------------------------
// ⭐️ [안정화] 파일 선택 로직 (팝업 트리거 추가) ⭐️
// -----------------------------------
photoInput.addEventListener("change", e => {
    console.log("File change event detected. Starting EXIF read."); 

    const file = e.target.files?.[0];
    
    if (!file) {
        uploadedFile = null;
        fileLabel.textContent = 'Choose File';
        extractedLocation = 'N/A';
        checkIfSearchReady();
        return;
    }
    
    uploadedFile = file;
    fileLabel.textContent = file.name; // 파일명 즉시 업데이트
    
    extractedLocation = 'Loading GPS...'; 
    checkIfSearchReady(); 

    EXIF.getData(file, function() { 
        const lat = EXIF.getTag(this, "GPSLatitude");
        const lon = EXIF.getTag(this, "GPSLongitude");
        let hasGps = false;

        if (lat && lon) {
            const latitude = toDecimal(lat).toFixed(4);
            const longitude = toDecimal(lon).toFixed(4);
            
            if (!isNaN(parseFloat(latitude)) && !isNaN(parseFloat(longitude))) {
                    extractedLocation = `${latitude}, ${longitude}`;
                    hasGps = true;
            } else {
                    extractedLocation = 'N/A (Invalid GPS Data)';
            }
        } else {
            extractedLocation = 'N/A (No GPS Data)'; 
        }
        
        console.log("EXIF data read complete. Location status:", extractedLocation);
        
        // ⭐️ [핵심 추가] GPS 정보가 없을 때 팝업을 띄웁니다. ⭐️
        // gpsErrorModal 변수가 Modal 객체로 초기화되어 있어야 합니다.
        if (extractedLocation === 'N/A (No GPS Data)' && gpsErrorModal) {
            gpsErrorModal.show();
        }
        
        checkIfSearchReady(); 
    });
});

setMinDate();
