#pragma once

#include <string>
#include <vector>
#include <cmath>
#include <memory>
#include <algorithm>
#include <new>
#include <cstdint>
#include <random>

// Arena allocator for fast node allocations
class MemoryArena {
private:
    uint8_t* m_buffer = nullptr;
    size_t m_capacity = 0;
    size_t m_offset = 0;

public:
    explicit MemoryArena(size_t capacity) : m_capacity(capacity), m_offset(0) {
        m_buffer = new uint8_t[capacity];
    }

    ~MemoryArena() {
        delete[] m_buffer;
    }

    MemoryArena(const MemoryArena&) = delete;
    MemoryArena& operator=(const MemoryArena&) = delete;

    void* allocate(size_t bytes, size_t alignment = alignof(std::max_align_t)) {
        std::uintptr_t current_ptr = reinterpret_cast<std::uintptr_t>(m_buffer + m_offset);
        std::uintptr_t aligned_ptr = (current_ptr + alignment - 1) & ~(alignment - 1);
        size_t new_offset = aligned_ptr - reinterpret_cast<std::uintptr_t>(m_buffer);
        
        if (new_offset + bytes > m_capacity) {
            throw std::bad_alloc();
        }
        m_offset = new_offset + bytes;
        return reinterpret_cast<void*>(m_buffer + new_offset);
    }

    template<typename T, typename... Args>
    T* create(Args&&... args) {
        void* ptr = allocate(sizeof(T), alignof(T));
        return new (ptr) T(std::forward<Args>(args)...);
    }

    void reset() {
        m_offset = 0;
    }

    size_t getUsedBytes() const {
        return m_offset;
    }

    size_t getCapacity() const {
        return m_capacity;
    }
};

// Base class for island repo nodes
class BaseProject {
public:
    std::string name;
    uint32_t stars = 0;
    std::string language;
    std::string url;
    uint32_t size = 0;
    bool isFork = false;

    double x = 0.0;
    double y = 0.0;
    double radius = 0.0;

    BaseProject(std::string n, uint32_t s, std::string lang, std::string u, uint32_t sz, bool fork, double init_x, double init_y)
        : name(std::move(n)), stars(s), language(std::move(lang)), url(std::move(u)), size(sz), isFork(fork), x(init_x), y(init_y) {}

    virtual ~BaseProject() = default;

    virtual void computeLandMass() = 0;
};

// Compiled/heavy project node
class FrameworkNode : public BaseProject {
public:
    using BaseProject::BaseProject;

    void computeLandMass() override {
        radius = 6.0 + std::sqrt(static_cast<double>(stars)) * 0.16 + std::sqrt(static_cast<double>(size)) * 0.05;
        if (radius > 18.0) radius = 18.0;
    }
};

// Script/light project node
class ScriptNode : public BaseProject {
public:
    using BaseProject::BaseProject;

    void computeLandMass() override {
        radius = 3.0 + std::sqrt(static_cast<double>(stars)) * 0.10 + std::sqrt(static_cast<double>(size)) * 0.03;
        if (radius > 18.0) radius = 18.0;
    }
};

struct BoundingBox {
    double xmin;
    double ymin;
    double xmax;
    double ymax;

    bool contains(double x, double y) const {
        return x >= xmin && x <= xmax && y >= ymin && y <= ymax;
    }

    bool intersects(const BoundingBox& other) const {
        return !(other.xmin > xmax || other.xmax < xmin || other.ymin > ymax || other.ymax < ymin);
    }
};

// 2D Quadtree with spiral collision resolution
class Quadtree {
private:
    static constexpr int MAX_CAPACITY = 16;
    static constexpr int MAX_DEPTH = 16;

    BoundingBox m_boundary;
    int m_depth;
    std::vector<BaseProject*> m_projects;
    bool m_divided = false;

    std::unique_ptr<Quadtree> nw;
    std::unique_ptr<Quadtree> ne;
    std::unique_ptr<Quadtree> sw;
    std::unique_ptr<Quadtree> se;

    void subdivide() {
        double xmid = (m_boundary.xmin + m_boundary.xmax) / 2.0;
        double ymid = (m_boundary.ymin + m_boundary.ymax) / 2.0;

        nw = std::make_unique<Quadtree>(BoundingBox{m_boundary.xmin, m_boundary.ymin, xmid, ymid}, m_depth + 1);
        ne = std::make_unique<Quadtree>(BoundingBox{xmid, m_boundary.ymin, m_boundary.xmax, ymid}, m_depth + 1);
        sw = std::make_unique<Quadtree>(BoundingBox{m_boundary.xmin, ymid, xmid, m_boundary.ymax}, m_depth + 1);
        se = std::make_unique<Quadtree>(BoundingBox{xmid, ymid, m_boundary.xmax, m_boundary.ymax}, m_depth + 1);

        m_divided = true;

        for (auto* proj : m_projects) {
            insertIntoChildren(proj);
        }
        m_projects.clear();
    }

    bool insertIntoChildren(BaseProject* proj) {
        if (nw->insert(proj)) return true;
        if (ne->insert(proj)) return true;
        if (sw->insert(proj)) return true;
        if (se->insert(proj)) return true;
        return false;
    }

public:
    Quadtree(BoundingBox boundary, int depth = 0) : m_boundary(boundary), m_depth(depth) {}

    bool insert(BaseProject* proj) {
        if (!m_boundary.contains(proj->x, proj->y)) {
            return false;
        }

        if (!m_divided) {
            if (m_projects.size() < MAX_CAPACITY || m_depth >= MAX_DEPTH) {
                m_projects.push_back(proj);
                return true;
            }
            subdivide();
        }

        return insertIntoChildren(proj);
    }

    void query(double xmin, double ymin, double xmax, double ymax, std::vector<BaseProject*>& found) const {
        BoundingBox searchBox{xmin, ymin, xmax, ymax};
        if (!m_boundary.intersects(searchBox)) {
            return;
        }

        if (m_divided) {
            nw->query(xmin, ymin, xmax, ymax, found);
            ne->query(xmin, ymin, xmax, ymax, found);
            sw->query(xmin, ymin, xmax, ymax, found);
            se->query(xmin, ymin, xmax, ymax, found);
        } else {
            for (auto* proj : m_projects) {
                if (searchBox.contains(proj->x, proj->y)) {
                    found.push_back(proj);
                }
            }
        }
    }

    void insertWithCollisionResolution(BaseProject* proj) {
        double original_x = proj->x;
        double original_y = proj->y;
        bool has_collision = true;
        int attempts = 0;
        double angle = 0.0;
        double step = proj->radius * 0.8;

        while (has_collision && attempts < 1000) {
            has_collision = false;
            double r_search = proj->radius * 2.5;
            std::vector<BaseProject*> neighbors;
            query(proj->x - r_search, proj->y - r_search, proj->x + r_search, proj->y + r_search, neighbors);

            for (auto* other : neighbors) {
                if (other == proj) continue;
                double dx = proj->x - other->x;
                double dy = proj->y - other->y;
                double dist = std::sqrt(dx * dx + dy * dy);
                double minDist = proj->radius + other->radius + 5.0;
                if (dist < minDist) {
                    has_collision = true;
                    break;
                }
            }

            if (has_collision) {
                attempts++;
                double r = step * std::sqrt(static_cast<double>(attempts));
                angle += 0.38197; // Golden angle step
                proj->x = original_x + r * std::cos(angle);
                proj->y = original_y + r * std::sin(angle);
            }
        }

        insert(proj);
    }
};
