#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <iomanip>
#include "SpatialEngine.h"

// Helper to escape JSON strings
std::string escapeJSON(const std::string& input) {
    std::ostringstream ss;
    for (char c : input) {
        if (c == '"') ss << "\\\"";
        else if (c == '\\') ss << "\\\\";
        else if (c == '\b') ss << "\\b";
        else if (c == '\f') ss << "\\f";
        else if (c == '\n') ss << "\\n";
        else if (c == '\r') ss << "\\r";
        else if (c == '\t') ss << "\\t";
        else ss << c;
    }
    return ss.str();
}

int main() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(NULL);

    std::string line;
    if (!std::getline(std::cin, line)) return 0;

    // First line is center coordinates: X Y
    double cx = 0, cy = 0;
    std::stringstream ss(line);
    ss >> cx >> cy;

    // Bounding box for Quadtree
    // It will adapt to any size, starting huge:
    BoundingBox worldBox{-1e9, -1e9, 1e9, 1e9};
    Quadtree tree(worldBox, 0);

    // We will allocate memory for nodes
    std::vector<std::unique_ptr<BaseProject>> projects;

    // Read TSV: STARS \t SIZE \t IS_FORK \t LANGUAGE \t NAME \t URL
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        std::stringstream ls(line);
        std::string token;
        
        uint32_t stars = 0, size = 0;
        bool isFork = false;
        std::string language, name, url;

        if (std::getline(ls, token, '\t')) stars = std::stoul(token);
        if (std::getline(ls, token, '\t')) size = std::stoul(token);
        if (std::getline(ls, token, '\t')) isFork = (token == "1" || token == "true");
        if (std::getline(ls, token, '\t')) language = token;
        if (std::getline(ls, token, '\t')) name = token;
        if (std::getline(ls, token, '\t')) url = token;

        std::unique_ptr<BaseProject> proj;
        // Determine type based on language
        if (language == "C++" || language == "Rust" || language == "C" || language == "Go" || language == "Java" || language == "C#") {
            proj = std::make_unique<FrameworkNode>(name, stars, language, url, size, isFork, cx, cy);
        } else {
            proj = std::make_unique<ScriptNode>(name, stars, language, url, size, isFork, cx, cy);
        }

        proj->computeLandMass();
        tree.insertWithCollisionResolution(proj.get());
        projects.push_back(std::move(proj));
    }

    // Output JSON
    std::cout << "[\n";
    for (size_t i = 0; i < projects.size(); ++i) {
        auto& p = projects[i];
        std::cout << "  {\n"
                  << "    \"name\": \"" << escapeJSON(p->name) << "\",\n"
                  << "    \"url\": \"" << escapeJSON(p->url) << "\",\n"
                  << "    \"language\": \"" << escapeJSON(p->language) << "\",\n"
                  << "    \"stars\": " << p->stars << ",\n"
                  << "    \"size\": " << p->size << ",\n"
                  << "    \"isFork\": " << (p->isFork ? "true" : "false") << ",\n"
                  << "    \"x\": " << std::fixed << std::setprecision(2) << p->x << ",\n"
                  << "    \"y\": " << std::fixed << std::setprecision(2) << p->y << ",\n"
                  << "    \"radius\": " << std::fixed << std::setprecision(2) << p->radius << "\n"
                  << "  }";
        if (i < projects.size() - 1) std::cout << ",";
        std::cout << "\n";
    }
    std::cout << "]\n";

    return 0;
}
