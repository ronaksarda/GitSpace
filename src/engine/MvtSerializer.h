#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <cstring>
#include <algorithm>

/**
 * @brief Utility for low-level Protocol Buffer byte serialization.
 */
class MvtWriter {
public:
    /**
     * @brief Encodes a 64-bit unsigned integer into a variable-length byte sequence.
     */
    static void writeVarint(std::vector<uint8_t>& buf, uint64_t val) {
        while (val >= 0x80) {
            buf.push_back(static_cast<uint8_t>((val & 0x7F) | 0x80));
            val >>= 7;
        }
        buf.push_back(static_cast<uint8_t>(val & 0x7F));
    }

    /**
     * @brief Writes a little-endian float value (wire type 5).
     */
    static void writeFloat(std::vector<uint8_t>& buf, float val) {
        uint32_t bits;
        std::memcpy(&bits, &val, 4);
        buf.push_back(static_cast<uint8_t>(bits & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 8) & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 16) & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 24) & 0xFF));
    }

    /**
     * @brief Writes a little-endian double value (wire type 1).
     */
    static void writeDouble(std::vector<uint8_t>& buf, double val) {
        uint64_t bits;
        std::memcpy(&bits, &val, 8);
        buf.push_back(static_cast<uint8_t>(bits & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 8) & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 16) & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 24) & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 32) & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 40) & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 48) & 0xFF));
        buf.push_back(static_cast<uint8_t>((bits >> 56) & 0xFF));
    }

    /**
     * @brief Writes a length-delimited string field (wire type 2).
     */
    static void writeStringField(std::vector<uint8_t>& buf, uint32_t field_num, const std::string& str) {
        writeVarint(buf, (field_num << 3) | 2);
        writeVarint(buf, str.size());
        buf.insert(buf.end(), str.begin(), str.end());
    }

    /**
     * @brief Writes a length-delimited nested message field (wire type 2).
     */
    static void writeMessageField(std::vector<uint8_t>& buf, uint32_t field_num, const std::vector<uint8_t>& sub_buf) {
        writeVarint(buf, (field_num << 3) | 2);
        writeVarint(buf, sub_buf.size());
        buf.insert(buf.end(), sub_buf.begin(), sub_buf.end());
    }

    /**
     * @brief Writes a varint field (wire type 0).
     */
    static void writeVarintField(std::vector<uint8_t>& buf, uint32_t field_num, uint64_t val) {
        writeVarint(buf, (field_num << 3) | 0);
        writeVarint(buf, val);
    }
};

/**
 * @brief Dynamic Value variant class mapping to the MVT protobuf Value message schema.
 */
struct PropertyValue {
    enum Type { STRING, FLOAT, DOUBLE, INT, UINT, BOOL };
    Type type;
    std::string str_val;
    float float_val = 0.0f;
    double double_val = 0.0;
    int64_t int_val = 0;
    uint64_t uint_val = 0;
    bool bool_val = false;

    static PropertyValue fromString(std::string s) {
        PropertyValue v;
        v.type = STRING;
        v.str_val = std::move(s);
        return v;
    }
    static PropertyValue fromFloat(float f) {
        PropertyValue v;
        v.type = FLOAT;
        v.float_val = f;
        return v;
    }
    static PropertyValue fromDouble(double d) {
        PropertyValue v;
        v.type = DOUBLE;
        v.double_val = d;
        return v;
    }
    static PropertyValue fromInt(int64_t i) {
        PropertyValue v;
        v.type = INT;
        v.int_val = i;
        return v;
    }
    static PropertyValue fromUint(uint64_t u) {
        PropertyValue v;
        v.type = UINT;
        v.uint_val = u;
        return v;
    }
    static PropertyValue fromBool(bool b) {
        PropertyValue v;
        v.type = BOOL;
        v.bool_val = b;
        return v;
    }

    /**
     * @brief Serializes the Value variant according to its protobuf tag types.
     */
    std::vector<uint8_t> serialize() const {
        std::vector<uint8_t> buf;
        if (type == STRING) {
            MvtWriter::writeStringField(buf, 1, str_val);
        } else if (type == FLOAT) {
            MvtWriter::writeVarint(buf, (2 << 3) | 5);
            MvtWriter::writeFloat(buf, float_val);
        } else if (type == DOUBLE) {
            MvtWriter::writeVarint(buf, (3 << 3) | 1);
            MvtWriter::writeDouble(buf, double_val);
        } else if (type == INT) {
            MvtWriter::writeVarintField(buf, 4, int_val);
        } else if (type == UINT) {
            MvtWriter::writeVarintField(buf, 5, uint_val);
        } else if (type == BOOL) {
            MvtWriter::writeVarintField(buf, 7, bool_val ? 1 : 0);
        }
        return buf;
    }

    bool operator==(const PropertyValue& other) const {
        if (type != other.type) return false;
        switch (type) {
            case STRING: return str_val == other.str_val;
            case FLOAT: return float_val == other.float_val;
            case DOUBLE: return double_val == other.double_val;
            case INT: return int_val == other.int_val;
            case UINT: return uint_val == other.uint_val;
            case BOOL: return bool_val == other.bool_val;
        }
        return false;
    }
};

/**
 * @brief Represents an individual feature in Mapbox Vector Tile format.
 */
struct MvtFeature {
    uint64_t id = 0;
    std::vector<std::pair<std::string, PropertyValue>> attributes;
    int32_t x = 0;
    int32_t y = 0;

    /**
     * @brief Encodes the feature and compiles tag dictionary offsets.
     */
    std::vector<uint8_t> serialize(const std::vector<std::string>& keys, const std::vector<PropertyValue>& values) const {
        std::vector<uint8_t> buf;

        // 1. ID
        if (id != 0) {
            MvtWriter::writeVarintField(buf, 1, id);
        }

        // 2. Tags (key-value index references)
        std::vector<uint8_t> tags_buf;
        for (const auto& attr : attributes) {
            auto k_it = std::find(keys.begin(), keys.end(), attr.first);
            uint32_t k_idx = 0;
            if (k_it != keys.end()) {
                k_idx = static_cast<uint32_t>(std::distance(keys.begin(), k_it));
            }

            auto v_it = std::find(values.begin(), values.end(), attr.second);
            uint32_t v_idx = 0;
            if (v_it != values.end()) {
                v_idx = static_cast<uint32_t>(std::distance(values.begin(), v_it));
            }

            MvtWriter::writeVarint(tags_buf, k_idx);
            MvtWriter::writeVarint(tags_buf, v_idx);
        }
        if (!tags_buf.empty()) {
            MvtWriter::writeMessageField(buf, 2, tags_buf);
        }

        // 3. Geometry Type: POINT = 1
        MvtWriter::writeVarintField(buf, 3, 1);

        // 4. Geometry Commands: MoveTo(1) command. CommandInteger = 9
        std::vector<uint8_t> geom_buf;
        MvtWriter::writeVarint(geom_buf, 9); // MoveTo, count 1

        auto zigzag = [](int32_t val) -> uint32_t {
            if (val < 0) return static_cast<uint32_t>(-val) * 2 - 1;
            return static_cast<uint32_t>(val) * 2;
        };

        MvtWriter::writeVarint(geom_buf, zigzag(x));
        MvtWriter::writeVarint(geom_buf, zigzag(y));

        MvtWriter::writeMessageField(buf, 4, geom_buf);

        return buf;
    }
};

/**
 * @brief Represents a single map layer holding multiple vector features.
 */
struct MvtLayer {
    std::string name;
    uint32_t extent = 4096;
    std::vector<MvtFeature> features;

    /**
     * @brief Consolidates unique keys and values, then serializes the MVT layer.
     */
    std::vector<uint8_t> serialize() const {
        std::vector<std::string> keys;
        std::vector<PropertyValue> values;

        for (const auto& feat : features) {
            for (const auto& attr : feat.attributes) {
                if (std::find(keys.begin(), keys.end(), attr.first) == keys.end()) {
                    keys.push_back(attr.first);
                }
                if (std::find(values.begin(), values.end(), attr.second) == values.end()) {
                    values.push_back(attr.second);
                }
            }
        }

        std::vector<uint8_t> buf;

        // 15. Version (MVT v2.1)
        MvtWriter::writeVarintField(buf, 15, 2);

        // 1. Layer Name
        MvtWriter::writeStringField(buf, 1, name);

        // 2. Features
        for (const auto& feat : features) {
            std::vector<uint8_t> feat_buf = feat.serialize(keys, values);
            MvtWriter::writeMessageField(buf, 2, feat_buf);
        }

        // 3. String Keys Dictionary
        for (const auto& key : keys) {
            MvtWriter::writeStringField(buf, 3, key);
        }

        // 4. Value Dictionary
        for (const auto& val : values) {
            std::vector<uint8_t> val_buf = val.serialize();
            MvtWriter::writeMessageField(buf, 4, val_buf);
        }

        // 5. Extent dimensions
        MvtWriter::writeVarintField(buf, 5, extent);

        return buf;
    }
};

/**
 * @brief Top-level Vector Tile container message.
 */
struct MvtTile {
    std::vector<MvtLayer> layers;

    /**
     * @brief Compiles the complete static tile payload.
     */
    std::vector<uint8_t> serialize() const {
        std::vector<uint8_t> buf;
        for (const auto& layer : layers) {
            std::vector<uint8_t> layer_buf = layer.serialize();
            MvtWriter::writeMessageField(buf, 3, layer_buf);
        }
        return buf;
    }
};
