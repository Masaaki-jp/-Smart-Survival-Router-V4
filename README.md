# -Smart-Survival-Router-V4

![info](overview.png)

# 🌩️ Smart Survival Router V4

[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?style=flat-square&logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Survival DX](https://img.shields.io/badge/Survival_DX-Optimization-ff69b4?style=flat-square)](https://note.com/masa_cloud)

気象ハザード（猛暑・酷暑・強風・雨）を検知し、Googleカレンダーの予定から「最適な交通手段」と「移動時間」を自動計算してカレンダーに予定を追加する Google Apps Script (GAS) です。

V4では、Google Maps Directions APIへの依存を脱却し、**「ハバーシンの公式（Haversine formula）」と「緯度経度キャッシュ」**を採用。API制限（クォータ）を完全に回避し、30日分の予定をわずか数秒で処理する爆速仕様に進化しました。

## ✨ Features (特徴)

- **🌦️ 気象ハザード連動**: 天気カレンダーから「猛暑(Severe Heat)」「強風(Windy)」「雨(Rain)」などのアラートを読み取り、命を守るための最適な移動手段（車、電車/バス、徒歩、自転車）を自動選択します。
- **🚀 爆速・API制限回避**: 重たいDirections APIを使用せず、ハバーシンの公式による直線距離計算と迂回係数（1.4倍）を用いて所要時間を自前で算出します。
- **💾 座標キャッシュ機能**: 住所の緯度経度（ジオコーディング結果）を `PropertiesService` に永続キャッシュするため、外部APIとの通信によるボトルネックが発生しません。
- **⚡ 超軽量処理**: 30日先までのスケジュールをスキャンしても約4秒で完了。GASの無料アカウント（1日90分制限）でも「5分おき」の高頻度トリガー運用が余裕で可能です。
- **💻 スマートな除外設定**: 場所に「zoom」「オンライン」「meet」等が含まれる予定は、自動で移動計算から除外されます。

## 🏗️ Architecture (仕組み)

1. **予定の抽出**: カレンダーから場所情報（Location）が入力されているイベントを取得します。
2. **ハザード判定**: 予定時刻の前後30分における気象アラートをチェックします。
3. **距離計算 (Haversine)**: 出発地と目的地の緯度経度（キャッシュから取得）から直線距離を算出し、各交通手段の時速で割って移動時間を割り出します。
4. **カレンダー反映**: 「[Train/Bus] 移動：会議名」といったタイトルで、出発時刻と到着時刻、および概算距離をカレンダーに自動登録します。

## 🛠️ Setup (導入手順)

### 1. GASプロジェクトの作成
Googleカレンダー、またはGoogle Driveから新しい Google Apps Script プロジェクトを作成します。

### 2. コードの配置
本リポジトリのコードを `Code.gs` に貼り付けます。

### 3. 設定値の変更
コード上部の定数（1. 設定部分）をご自身の環境に合わせて変更してください。

```javascript
const HOME_ADDRESS = '神奈川県川崎市中原区下新城2-3-26'; // あなたの自宅・拠点の住所
const BUFFER_MINUTES = 5; // 到着余裕時間（分）
const WEATHER_CALENDAR_ID = 'あなたの天気連携用カレンダーID@group.calendar.google.com';
const DAYS_TO_CHECK = 30; // 何日先まで計算するか
