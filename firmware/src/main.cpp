/**
 * صندوق الروضة — بطاقة أو زرّ، سطرُ JSON واحد لكلٍّ.
 *
 * ⚠️ الحدّ الذي تقوم عليه المنظومة كلّها:
 * هذه اللوحة **لا تعرف معنى البطاقة ولا معنى الزرّ**. ترسل رقماً أو موضعاً،
 * ولا شيء غير ذلك. المعنى يعيش في جدول المنصّة، والقصّة تعرف الأسماء وحدها.
 * فتُفقد بطاقة؟ تُربط أخرى بالاسم نفسه ولا تتغيّر القصّة بحرف. ولو دخل رقم
 * البطاقة في المحتوى لانكسر ذلك كلّه.
 *
 * المخرَج سطرٌ واحد لكل حدث، JSON، على 115200:
 *
 *   {"v":1,"type":"card_detected","uid":"040A1B2C"}
 *   {"v":1,"type":"button","index":2}
 *   {"v":1,"type":"heartbeat"}
 *
 * `v` من اليوم الأول: بدونه لا سبيل لتغيير الشكل لاحقاً دون كسر كل صندوق
 * مثبَّت في روضة.
 */

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>

#include "pins.h"

MFRC522 mfrc522(SS_PIN, RST_PIN);

/**
 * رقم البطاقة: hex كبير، بصفر بادئ، بلا فواصل.
 *
 * ⚠️ `Serial.print(byte, HEX)` **يُسقط الصفر البادئ**: البايت 0x0A يُطبع
 * "A" لا "0A". فبطاقة 04 0A 1B 2C تعطي "40A1B2C"، وأخرى مختلفة تعطي النصّ
 * نفسه — بطاقتان برقم واحد. وهو عطل لا يظهر إلا أمام الصف ولا يفسّره شيء.
 */
static String uidHex() {
    String out;
    for (byte i = 0; i < mfrc522.uid.size; i++) {
        if (mfrc522.uid.uidByte[i] < 0x10) out += '0';
        out += String(mfrc522.uid.uidByte[i], HEX);
    }
    out.toUpperCase();
    return out;
}

/** وميض قصير — تأكيد بصري أن الضغطة أو المسحة وصلت. */
static void blink(uint8_t index) {
    if (index >= BUTTON_COUNT) return;
    digitalWrite(LED_PINS[index], HIGH);
    delay(120);
    digitalWrite(LED_PINS[index], LOW);
}

static bool     lastState[BUTTON_COUNT];
static uint32_t lastChange[BUTTON_COUNT];

/** الارتداد الميكانيكي يولّد عشرات الحوافّ في ضغطة واحدة. */
static const uint16_t DEBOUNCE_MS = 40;

void setup() {
    Serial.begin(115200);
    delay(300);

    for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
        // مدخلا 34/35 بلا رفع داخلي — مقاومتهما خارجية (انظر pins.h).
        pinMode(BUTTON_PINS[i], BUTTON_NEEDS_EXTERNAL_PULLUP[i] ? INPUT : INPUT_PULLUP);
        pinMode(LED_PINS[i], OUTPUT);
        digitalWrite(LED_PINS[i], LOW);
        lastState[i] = HIGH;   // مرفوع = غير مضغوط
        lastChange[i] = 0;
    }

    SPI.begin();
    mfrc522.PCD_Init();
    delay(50);

    // 0x91/0x92 سليم، و0x00/0xFF توصيل خاطئ. يُطبع كتعليق لا كحدث، فلا
    // يخلط على المنصّة سطراً ليس من العقد.
    byte version = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
    Serial.print("# reader version 0x");
    Serial.println(version, HEX);
    Serial.flush();
}

void loop() {
    // ── الأزرار ───────────────────────────────────────────────────────────
    for (uint8_t i = 0; i < BUTTON_COUNT; i++) {
        bool state = digitalRead(BUTTON_PINS[i]);
        if (state == lastState[i]) continue;
        if (millis() - lastChange[i] < DEBOUNCE_MS) continue;

        lastChange[i] = millis();
        lastState[i] = state;

        // عند الضغط وحده (هبوط إلى الأرضي) — لا عند الإفلات، وإلّا عُدّت
        // كل ضغطة اختيارين.
        if (state == LOW) {
            Serial.print("{\"v\":1,\"type\":\"button\",\"index\":");
            Serial.print(i + 1);   // موضعٌ يبدأ من ١، كما تعدّه المنصّة
            Serial.println("}");
            Serial.flush();
            blink(i);
        }
    }

    // ── البطاقة ───────────────────────────────────────────────────────────
    if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
        Serial.print("{\"v\":1,\"type\":\"card_detected\",\"uid\":\"");
        Serial.print(uidHex());
        Serial.println("\"}");
        Serial.flush();
        blink(0);

        mfrc522.PICC_HaltA();
        // بدونها تُقرأ بطاقة واحدة ثم يتجمّد القارئ حتى إعادة التشغيل.
        mfrc522.PCD_StopCrypto1();
        delay(400);   // يمنع عدّ مسحة واحدة مرّتين
    }

    // ── نبضة ──────────────────────────────────────────────────────────────
    // بها تعرف المنصّة أن الصندوق حيّ لا صامت — وهو الفرق بين «لا أحد يضغط»
    // و«الكبل مفصول».
    static uint32_t lastBeat = 0;
    if (millis() - lastBeat > 5000) {
        lastBeat = millis();
        Serial.println("{\"v\":1,\"type\":\"heartbeat\"}");
        Serial.flush();
    }
}
